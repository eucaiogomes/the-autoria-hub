import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SkipBack, Play, Pause, SkipForward, Volume2, Maximize2, Scissors, Trash2, Save,
  Video, Image as ImageIcon, ArrowLeft, List, Upload, Film, Music, Plus, MousePointer2,
  Undo2, Redo2, Presentation,
} from "lucide-react";
import JSZip from "jszip";
import { renderPptxToImages } from "@/lib/pptx";
import { useStudio } from "@/state/studio";
import { lectorLogoUrl } from "@/lib/defaultLesson";
import ChaptersPanel from "@/components/ChaptersPanel";
import RecordSidebar from "@/components/RecordSidebar";
import { toast } from "sonner";

type Kind = "video" | "slide" | "audio" | "image";
type Role = "base" | "overlay";
type Source = "webcam" | "screen" | "upload" | "slide";
/** Position/size on the 16:9 stage as % (0-100). */
export type Transform = { x: number; y: number; w: number; h: number };
type Segment = {
  id: string;
  kind: Kind;
  layer: number;
  start: number;
  srcStart: number;
  srcEnd: number;
  label: string;
  mediaUrl?: string;
  slideUrl?: string;
  mediaDuration?: number;
  role?: Role;
  source?: Source;
  /** Free position/size on the preview stage. Defaults applied when missing. */
  transform?: Transform;
};

const defaultTransform = (s: { kind: Kind; role?: Role; source?: Source }): Transform => {
  if (s.role === "base") return { x: 0, y: 0, w: 100, h: 100 };
  if (s.kind === "video" && s.source === "webcam") return { x: 75, y: 70, w: 22, h: 28 };
  if (s.kind === "video" && s.source === "screen") return { x: 50, y: 50, w: 50, h: 50 };
  // image overlays default to full-stage so existing logo behavior is preserved
  return { x: 0, y: 0, w: 100, h: 100 };
};
const tf = (s: Segment): Transform => s.transform ?? defaultTransform(s);

const uid = () => Math.random().toString(36).slice(2, 9);
const lenOf = (s: Segment) => s.srcEnd - s.srcStart;
const endOf = (s: Segment) => s.start + lenOf(s);
const isStretchable = (s: Segment) => s.mediaDuration === undefined;
const maxSrcEnd = (s: Segment) => (s.mediaDuration ?? Infinity);
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end - 1e-3 && b.start < a.end - 1e-3;

function findFreeLayer(segs: Segment[], start: number, len: number, ignoreId?: string, preferred?: number): number {
  const end = start + len;
  const tryLayer = (L: number) =>
    !segs.some((s) => s.id !== ignoreId && s.layer === L && overlaps({ start, end }, { start: s.start, end: endOf(s) }));
  if (preferred !== undefined && tryLayer(preferred)) return preferred;
  for (let L = 0; L < 64; L++) if (tryLayer(L)) return L;
  return 0;
}

export default function EditStudio() {
  const { recording, setView, appendRecording, setAppendRecording } = useStudio();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const ovVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
  const [zoom, setZoom] = useState(1);
  const [timelineH, setTimelineH] = useState(260);
  const [recordOpen, setRecordOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [liveScreenStream, setLiveScreenStream] = useState<MediaStream | null>(null);
  const [liveScreenRole, setLiveScreenRole] = useState<Role>("base");

  // When recording starts, pause playback to keep the playhead anchored
  useEffect(() => { if (isRecording) setPlaying(false); }, [isRecording]);

  // ===== Undo / Redo history =====
  const historyRef = useRef<Segment[][]>([]);
  const futureRef = useRef<Segment[][]>([]);
  const skipHistoryRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  useEffect(() => {
    if (skipHistoryRef.current) { skipHistoryRef.current = false; return; }
    historyRef.current.push(segments);
    if (historyRef.current.length > 100) historyRef.current.shift();
    futureRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, [segments]);
  const undo = () => {
    if (historyRef.current.length < 2) return;
    const current = historyRef.current.pop()!;
    futureRef.current.push(current);
    const prev = historyRef.current[historyRef.current.length - 1];
    skipHistoryRef.current = true;
    setSegments(prev);
    setHistoryVersion((v) => v + 1);
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(next);
    skipHistoryRef.current = true;
    setSegments(next);
    setHistoryVersion((v) => v + 1);
  };
  const canUndo = historyRef.current.length > 1;
  const canRedo = futureRef.current.length > 0;

  // ===== Dual markers (in/out) =====
  const [markerIn, setMarkerIn] = useState<number | null>(null);
  const [markerOut, setMarkerOut] = useState<number | null>(null);

  // ===== Rubber-band selection =====
  const [rubberBand, setRubberBand] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const isRubberBanding = useRef(false);

  const toggleSelect = (id: string, additive: boolean) => {
    setSelectedIds((prev) => {
      if (!additive) return new Set([id]);
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Build initial segments
  useEffect(() => {
    if (segments.length > 0) return;
    if (!recording) {
      setSegments([
        { id: uid(), kind: "slide", layer: 0, start: 0, srcStart: 0, srcEnd: 10, label: "Slide em branco", role: "base", source: "slide" },
      ]);
      return;
    }
    const dur = recording.duration;
    const slideSegs: Segment[] = recording.slideMarkers.map((m, i) => {
      const next = recording.slideMarkers[i + 1]?.time ?? dur;
      const slide = recording.slides.find((s) => s.id === m.slideId);
      return {
        id: uid(), kind: "slide", layer: 0,
        start: m.time, srcStart: 0, srcEnd: next - m.time,
        label: slide?.name ?? `Slide ${i + 1}`, slideUrl: slide?.url,
        role: "base" as Role, source: "slide" as Source,
      };
    });
    const initial: Segment[] = [
      ...slideSegs,
      ...(recording.audioOnly
        ? []
        : [{ id: uid(), kind: "video" as Kind, layer: 1, start: 0, srcStart: 0, srcEnd: dur, label: "Webcam", mediaUrl: recording.videoUrl, mediaDuration: dur, role: "overlay" as Role, source: "webcam" as Source }]),
      { id: uid(), kind: "image", layer: 2, start: 0, srcStart: 0, srcEnd: dur, label: "Logo Lector", mediaUrl: lectorLogoUrl(), role: "overlay", source: "upload" },
      { id: uid(), kind: "audio", layer: 3, start: 0, srcStart: 0, srcEnd: dur, label: "Áudio", mediaUrl: recording.videoUrl, mediaDuration: dur, source: "webcam" },
    ];
    setSegments(initial);
  }, [recording]); // eslint-disable-line

  // Append new recording
  useEffect(() => {
    if (!appendRecording) return;
    const r = appendRecording as any;
    const newIds: string[] = [];
    setSegments((prev) => {
      const tEnd = r.startAt !== undefined
        ? r.startAt
        : prev.reduce((a, s) => Math.max(a, endOf(s)), 0);
      const acc: Segment[] = [...prev];
      const place = (seg: Omit<Segment, "layer" | "id">, preferred?: number) => {
        const layer = findFreeLayer(acc, seg.start, seg.srcEnd - seg.srcStart, undefined, preferred);
        const id = uid();
        const full: Segment = { ...seg, id, layer };
        acc.push(full);
        newIds.push(id);
      };

      // Slide markers
      r.slideMarkers.forEach((m: any, i: number) => {
        const next = r.slideMarkers[i + 1]?.time ?? r.duration;
        const slide = r.slides.find((s: any) => s.id === m.slideId);
        place({ kind: "slide", start: tEnd + m.time, srcStart: 0, srcEnd: next - m.time, label: slide?.name ?? "Slide", slideUrl: slide?.url, role: "base", source: "slide" }, 0);
      });

      // If this recording has a screen capture
      const screenRole = r._screenRole as Role | undefined;
      const source = r._source as string | undefined;
      const extra = r._extra as any;

      if (source === "screen" && screenRole) {
        // Screen recording segment
        const isBase = screenRole === "base";
        // If screen is base, remove the blank slide at this time range
        if (isBase) {
          const toRemove = acc.filter(s =>
            s.kind === "slide" && s.role === "base" && !s.slideUrl && !s.mediaUrl
            && s.start < tEnd + r.duration && endOf(s) > tEnd
          );
          toRemove.forEach(s => {
            const idx = acc.indexOf(s);
            if (idx >= 0) acc.splice(idx, 1);
          });
        }
        place({
          kind: "video", start: tEnd, srcStart: 0, srcEnd: r.duration,
          label: isBase ? "Tela (principal)" : "Tela (overlay)",
          mediaUrl: r.videoUrl, mediaDuration: r.duration,
          role: screenRole, source: "screen",
        }, isBase ? 0 : undefined);

        // Also add the webcam from _extra
        if (extra) {
          place({
            kind: "video", start: tEnd, srcStart: 0, srcEnd: extra.duration,
            label: "Webcam", mediaUrl: extra.videoUrl, mediaDuration: extra.duration,
            role: "overlay", source: "webcam",
          }, 1);
          place({
            kind: "audio", start: tEnd, srcStart: 0, srcEnd: extra.duration,
            label: "Áudio", mediaUrl: extra.videoUrl, mediaDuration: extra.duration,
            source: "webcam",
          }, 2);
        }
      } else {
        // Standard webcam-only recording
        place({
          kind: "video", start: tEnd, srcStart: 0, srcEnd: r.duration,
          label: "Webcam", mediaUrl: r.videoUrl, mediaDuration: r.duration,
          role: "overlay", source: "webcam",
        }, 1);
        place({
          kind: "audio", start: tEnd, srcStart: 0, srcEnd: r.duration,
          label: "Áudio", mediaUrl: r.videoUrl, mediaDuration: r.duration,
          source: "webcam",
        }, 2);
      }
      return acc;
    });
    // Auto-select the new video segment for clarity
    if (newIds.length > 0) setSelectedIds(new Set([newIds[newIds.length - 2] ?? newIds[0]]));
    setAppendRecording(null);
    toast.success("Gravação adicionada à timeline");
  }, [appendRecording, setAppendRecording]);

  const duration = useMemo(
    () => Math.max(5, segments.reduce((a, s) => Math.max(a, endOf(s)), 0)),
    [segments],
  );
  const layerCount = useMemo(
    () => Math.max(3, segments.reduce((a, s) => Math.max(a, s.layer + 1), 0) + 1),
    [segments],
  );

  const active = useMemo(
    () => segments.filter((s) => time >= s.start && time < endOf(s)).sort((a, b) => a.layer - b.layer),
    [segments, time],
  );
  const mainVideo = active.find((s) => s.kind === "video" && s.source !== "screen");
  const screenVideo = active.find((s) => s.kind === "video" && s.source === "screen");
  const mainSlide = active.find((s) => s.kind === "slide");
  const overlayImages = active.filter((s) => s.kind === "image");
  const activeAudios = active.filter((s) => s.kind === "audio" || s.kind === "video");

  /** Check if a real base layer exists at a given time (ignoring blank slides without content). */
  const hasRealBaseAt = useCallback((t: number): boolean => {
    return segments.some((s) => {
      if (t < s.start || t >= endOf(s)) return false;
      if (s.role !== "base") return false;
      // A blank slide (no slideUrl, no mediaUrl) doesn't count as "real" content
      if (s.kind === "slide" && !s.slideUrl && !s.mediaUrl) return false;
      return true;
    });
  }, [segments]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!mainVideo?.mediaUrl) { v.removeAttribute("src"); return; }
    if (!v.src.includes(mainVideo.mediaUrl)) v.src = mainVideo.mediaUrl;
  }, [mainVideo?.mediaUrl]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0; let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setTime((prev) => {
        const nt = prev + dt;
        if (nt >= duration) { setPlaying(false); return duration; }
        return nt;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  useEffect(() => {
    const v = videoRef.current;
    if (v && mainVideo) {
      const target = mainVideo.srcStart + (time - mainVideo.start);
      if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
      if (playing) v.play().catch(() => {}); else v.pause();
    } else if (v) v.pause();
    Object.entries(audioRefs.current).forEach(([id, el]) => {
      if (!el) return;
      const seg = segments.find((s) => s.id === id);
      if (!seg) return;
      const isActive = activeAudios.some((a) => a.id === id);
      if (isActive) {
        const target = seg.srcStart + (time - seg.start);
        if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
        if (playing) el.play().catch(() => {}); else el.pause();
      } else el.pause();
    });
  }, [time, playing, mainVideo, activeAudios, segments]);

  // ===== ops =====
  const seek = (t: number) => setTime(Math.max(0, Math.min(duration, t)));
  const toggle = () => setPlaying((p) => !p);

  const addSegment = (seg: Omit<Segment, "id" | "layer">) => {
    setSegments((prev) => {
      const layer = findFreeLayer(prev, seg.start, seg.srcEnd - seg.srcStart);
      return [...prev, { ...seg, id: uid(), layer }];
    });
  };

  const splitAtPlayhead = () => {
    // No selection → split ALL clips under the playhead.
    // With selection → split only selected clips under the playhead.
    const pool = selectedIds.size === 0
      ? segments
      : segments.filter((s) => selectedIds.has(s.id));
    const targets = pool.filter(
      (s) => time > s.start + 0.05 && time < endOf(s) - 0.05,
    );
    if (targets.length === 0) {
      return toast.error(
        selectedIds.size === 0
          ? "Posicione o cursor sobre um clip"
          : "Posicione o cursor dentro de um clip selecionado",
      );
    }
    const newSel = new Set<string>();
    setSegments((prev) =>
      prev.flatMap((s) => {
        if (!targets.find((t) => t.id === s.id)) return [s];
        const local = time - s.start;
        const splitSrc = s.srcStart + local;
        const a: Segment = { ...s, id: uid(), srcEnd: splitSrc };
        const b: Segment = { ...s, id: uid(), srcStart: splitSrc, start: s.start + local };
        newSel.add(b.id);
        return [a, b];
      }),
    );
    setSelectedIds(newSel);
    toast.success(`${targets.length} clip(s) dividido(s)`);
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    setSegments((prev) => prev.filter((s) => !selectedIds.has(s.id)));
    setSelectedIds(new Set());
  };

  // Delete segments between markers (in/out region)
  const deleteMarkerRegion = () => {
    if (markerIn === null || markerOut === null) return;
    const lo = Math.min(markerIn, markerOut);
    const hi = Math.max(markerIn, markerOut);
    const gap = hi - lo;
    const applyToAll = selectedIds.size === 0;
    setSegments((prev) => {
      // First pass: trim/remove pieces inside the region per affected segment.
      const result: Segment[] = [];
      const affectedLayers = new Set<number>();
      for (const s of prev) {
        const affected = applyToAll || selectedIds.has(s.id);
        if (!affected) { result.push(s); continue; }
        const sEnd = endOf(s);
        if (sEnd <= lo || s.start >= hi) { result.push(s); continue; }
        affectedLayers.add(s.layer);
        if (s.start >= lo && sEnd <= hi) continue; // fully inside → drop
        if (s.start < lo) {
          const trimEnd = lo - s.start;
          result.push({ ...s, id: uid(), srcEnd: s.srcStart + trimEnd });
        }
        if (sEnd > hi) {
          const trimStart = hi - s.start;
          result.push({ ...s, id: uid(), srcStart: s.srcStart + trimStart, start: hi });
        }
      }
      // Second pass: ripple — on each affected layer, slide later clips left by `gap`.
      return result.map((s) => {
        if (!affectedLayers.has(s.layer)) return s;
        if (s.start >= hi - 1e-3) return { ...s, start: Math.max(0, s.start - gap) };
        return s;
      });
    });
    toast.success(`Região ${fmt(lo)} → ${fmt(hi)} removida`);
    setMarkerIn(null);
    setMarkerOut(null);
  };

  const trim = (id: string, edge: "start" | "end", deltaSec: number) => {
    setSegments((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const sameLayer = prev.filter((x) => x.id !== id && x.layer === s.layer);
      if (edge === "start") {
        let newSrcStart = Math.max(0, Math.min(s.srcEnd - 0.1, s.srcStart + deltaSec));
        let newStart = s.start + (newSrcStart - s.srcStart);
        const prevSeg = sameLayer.filter((x) => endOf(x) <= s.start + 1e-3).sort((a, b) => endOf(b) - endOf(a))[0];
        if (prevSeg && newStart < endOf(prevSeg)) {
          const diff = endOf(prevSeg) - newStart;
          newStart += diff; newSrcStart += diff;
          if (newSrcStart >= s.srcEnd) return s;
        }
        return { ...s, srcStart: newSrcStart, start: newStart };
      } else {
        const cap = maxSrcEnd(s);
        let newSrcEnd = Math.max(s.srcStart + 0.1, Math.min(cap, s.srcEnd + deltaSec));
        const newEnd = s.start + (newSrcEnd - s.srcStart);
        const nextSeg = sameLayer.filter((x) => x.start >= endOf(s) - 1e-3).sort((a, b) => a.start - b.start)[0];
        if (nextSeg && newEnd > nextSeg.start) {
          newSrcEnd = s.srcStart + (nextSeg.start - s.start);
          if (newSrcEnd <= s.srcStart) return s;
        }
        return { ...s, srcEnd: newSrcEnd };
      }
    }));
  };

  // ===== Drag preview / insertion indicator (Canva/CapCut style) =====
  type DragItem = { id: string; layer: number; start: number; length: number };
  type DragPreview = {
    anchorId: string;
    items: DragItem[];
    /** Per-layer ripple insertion point (only for the anchor's layer). */
    insertAt: number | null;
    insertLayer: number;
    /** Length used to ripple-shift later clips on insertLayer. */
    rippleLength: number;
  };
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);

  /** Compute snap-aware preview from a proposed (start, layer) for a given anchor segment.
   *  When the anchor is part of a multi-selection, all selected items move with the same
   *  start/layer deltas, preserving relative positioning. */
  const computeDragPreview = useCallback(
    (anchorId: string, proposedStart: number, proposedLayer: number): DragPreview | null => {
      const anchor = segments.find((s) => s.id === anchorId);
      if (!anchor) return null;

      const groupIds =
        selectedIds.has(anchorId) && selectedIds.size > 1
          ? new Set(selectedIds)
          : new Set([anchorId]);
      const group = segments.filter((s) => groupIds.has(s.id));

      // Clamp deltas so no item goes below 0 (start or layer).
      const desiredDStart = Math.max(0, proposedStart) - anchor.start;
      const desiredDLayer = Math.max(0, proposedLayer) - anchor.layer;
      const minStart = Math.min(...group.map((s) => s.start));
      const minLayer = Math.min(...group.map((s) => s.layer));
      const dStart = Math.max(desiredDStart, -minStart);
      const dLayer = Math.max(desiredDLayer, -minLayer);

      const items: DragItem[] = group.map((s) => ({
        id: s.id,
        layer: s.layer + dLayer,
        start: s.start + dStart,
        length: lenOf(s),
      }));

      // Insertion (ripple) when the dropped clip overlaps any clip already on
      // the target layer — works for both same-layer reorder and cross-layer drops,
      // so segments never visually stack on top of each other.
      const anchorItem = items.find((i) => i.id === anchorId)!;
      const others = segments.filter((s) => !groupIds.has(s.id) && s.layer === anchorItem.layer);
      const anchorEnd = anchorItem.start + anchorItem.length;
      const overlapping = others.find(
        (s) => anchorItem.start < endOf(s) - 1e-3 && anchorEnd > s.start + 1e-3,
      );

      if (!overlapping) {
        return {
          anchorId,
          items,
          insertAt: null,
          insertLayer: anchorItem.layer,
          rippleLength: anchorItem.length,
        };
      }
      const draggedCenter = anchorItem.start + anchorItem.length / 2;
      const segCenter = overlapping.start + lenOf(overlapping) / 2;
      const insertAt = draggedCenter < segCenter ? overlapping.start : endOf(overlapping);
      const groupOnLayer = items.filter((i) => i.layer === anchorItem.layer);
      const lo = Math.min(...groupOnLayer.map((i) => i.start));
      const hi = Math.max(...groupOnLayer.map((i) => i.start + i.length));
      return {
        anchorId,
        items,
        insertAt,
        insertLayer: anchorItem.layer,
        rippleLength: hi - lo,
      };
    },
    [segments, selectedIds],
  );

  const updateDragPreview = (id: string, proposedStart: number, proposedLayer: number) => {
    const dp = computeDragPreview(id, proposedStart, proposedLayer);
    dragPreviewRef.current = dp;
    setDragPreview(dp);
  };

  const commitDrag = () => {
    const dp = dragPreviewRef.current;
    dragPreviewRef.current = null;
    setDragPreview(null);
    if (!dp) return;
    setSegments((prev) => {
      const itemsById = new Map(dp.items.map((i) => [i.id, i]));
      const groupIds = new Set(dp.items.map((i) => i.id));

      // ===== 1) Compute source-gap closure per origin layer =====
      // For every layer the moving group is leaving (or rearranging within),
      // we collapse the contiguous footprint of the removed clips so later
      // clips slide back by exactly that length. This works the same whether
      // the move stays on-layer, jumps to a new layer, or lands on empty space.
      type Gap = { lo: number; hi: number; len: number };
      const gapsByLayer = new Map<number, Gap>();
      for (const s of prev) {
        if (!groupIds.has(s.id)) continue;
        const g = gapsByLayer.get(s.layer);
        if (!g) {
          gapsByLayer.set(s.layer, { lo: s.start, hi: endOf(s), len: 0 });
        } else {
          g.lo = Math.min(g.lo, s.start);
          g.hi = Math.max(g.hi, endOf(s));
        }
      }
      gapsByLayer.forEach((g) => { g.len = Math.max(0, g.hi - g.lo); });

      const insertLayer = dp.insertLayer;
      const insertAt = dp.insertAt;
      const rippleLength = dp.rippleLength;
      const groupOnInsertLayer = dp.items.filter((i) => i.layer === insertLayer);
      const groupLo = groupOnInsertLayer.length
        ? Math.min(...groupOnInsertLayer.map((i) => i.start))
        : 0;

      // If inserting on a layer the group is also leaving, the source gap on
      // that same layer closes BEFORE we reserve space, so any insertAt that
      // sits past the source must shift left by that gap length.
      let effectiveInsertAt = insertAt;
      if (insertAt !== null) {
        const sameLayerGap = gapsByLayer.get(insertLayer);
        if (sameLayerGap && insertAt > sameLayerGap.hi - 1e-3) {
          effectiveInsertAt = insertAt - sameLayerGap.len;
        }
      }

      const placed = prev.map((s) => {
        const it = itemsById.get(s.id);
        if (it) {
          // Moving clip: place at preview position, but if it lands on the
          // insert layer with a ripple, anchor it at the effective insert point.
          if (insertAt !== null && it.layer === insertLayer) {
            return { ...s, start: (effectiveInsertAt as number) + (it.start - groupLo), layer: it.layer };
          }
          return { ...s, start: it.start, layer: it.layer };
        }
        // Stationary clip on a layer affected by the move.
        let ns = s.start;
        const gap = gapsByLayer.get(s.layer);
        // 1) Close source gap on this layer (if the moving group was here).
        if (gap && gap.len > 0 && s.start >= gap.hi - 1e-3) {
          ns -= gap.len;
        }
        // 2) Open destination space on the insert layer.
        if (insertAt !== null && s.layer === insertLayer && ns >= (effectiveInsertAt as number) - 1e-3) {
          ns += rippleLength;
        }
        return ns !== s.start ? { ...s, start: ns } : s;
      });

      // ===== Final overlap guard =====
      // After placing/rippling, sweep every layer the move touched and push
      // any still-overlapping stationary clip rightward so two clips never
      // visually stack on the same layer.
      const touchedLayers = new Set<number>();
      dp.items.forEach((i) => touchedLayers.add(i.layer));
      gapsByLayer.forEach((_, L) => touchedLayers.add(L));
      const movedIds = new Set(dp.items.map((i) => i.id));
      const byId = new Map(placed.map((s) => [s.id, { ...s }]));
      for (const L of touchedLayers) {
        const onLayer = placed
          .filter((s) => s.layer === L)
          .map((s) => byId.get(s.id)!)
          .sort((a, b) => a.start - b.start);
        for (let i = 1; i < onLayer.length; i++) {
          const prevSeg = onLayer[i - 1];
          const cur = onLayer[i];
          const prevEnd = prevSeg.start + (prevSeg.srcEnd - prevSeg.srcStart);
          if (cur.start < prevEnd - 1e-3) {
            // Prefer pushing the non-moved clip; if the moved one is later,
            // still push the later clip to keep the user's drop position.
            if (movedIds.has(cur.id) && !movedIds.has(prevSeg.id)) {
              // moved clip dropped into stationary clip → push stationary back
              const shift = prevEnd - cur.start;
              prevSeg.start = Math.max(0, prevSeg.start - shift);
              // re-sort handled by next iter; simpler: just push cur instead
              cur.start = prevEnd;
            } else {
              cur.start = prevEnd;
            }
          }
        }
      }
      return placed.map((s) => byId.get(s.id) ?? s);
    });
  };

  const cancelDrag = () => {
    dragPreviewRef.current = null;
    setDragPreview(null);
  };

  const onUploadMedia = async (files: FileList | null) => {
    if (!files) return;
    const newSegs: Segment[] = [];
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      const isVideo = f.type.startsWith("video/");
      const isAudio = f.type.startsWith("audio/");
      let dur = 5;
      if (isVideo || isAudio) {
        dur = await new Promise<number>((res) => {
          const el = document.createElement(isVideo ? "video" : "audio") as HTMLMediaElement;
          el.preload = "metadata"; el.src = url;
          el.onloadedmetadata = () => res(el.duration || 5);
          el.onerror = () => res(5);
        });
      }
      const kind: Kind = isAudio ? "audio" : isVideo ? "video" : "image";
      newSegs.push({
        id: uid(),
        kind,
        layer: 0, // assigned below
        start: time,
        srcStart: 0,
        srcEnd: dur,
        label: f.name,
        mediaUrl: url,
        mediaDuration: isVideo || isAudio ? dur : undefined,
      });
    }
    setSegments((prev) => {
      const acc = [...prev];
      for (const s of newSegs) {
        // Always place imported media on a brand-new track below existing ones
        // so it never visually overlaps webcam/áudio/slide already on the timeline.
        const baseLayer = acc.reduce((a, x) => Math.max(a, x.layer + 1), 0);
        const layer = findFreeLayer(acc, s.start, lenOf(s), undefined, baseLayer);
        acc.push({ ...s, layer });
      }
      return acc;
    });
    toast.success("Mídia adicionada");
  };

  const onUploadPptx = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      return toast.error("Selecione um arquivo .pptx");
    }
    const loadingId = toast.loading(`Processando ${file.name}...`);
    try {
      const rendered = await renderPptxToImages(file);
      if (rendered.length === 0) {
        toast.dismiss(loadingId);
        return toast.error("Nenhum slide encontrado");
      }

      const SLIDE_DURATION = 5;
      let cursor = segments.reduce((a, s) => Math.max(a, endOf(s)), 0);
      const newSegs: Segment[] = rendered.map((s, i) => {
        const seg: Segment = {
          id: uid(),
          kind: "slide",
          layer: 0,
          start: cursor,
          srcStart: 0,
          srcEnd: SLIDE_DURATION,
          label: `Slide ${i + 1}`,
          slideUrl: s.url,
        };
        cursor += SLIDE_DURATION;
        return seg;
      });

      setSegments((prev) => {
        const acc = [...prev];
        for (const s of newSegs) {
          const layer = findFreeLayer(acc, s.start, lenOf(s), undefined, 0);
          acc.push({ ...s, layer });
        }
        return acc;
      });
      toast.dismiss(loadingId);
      toast.success(`${newSegs.length} slides importados como capítulos`);
    } catch (err) {
      console.error(err);
      toast.dismiss(loadingId);
      toast.error("Falha ao ler o PowerPoint");
    }
  };

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const PX_PER_SEC = 40 * zoom;
  const trackPxWidth = Math.max(duration * PX_PER_SEC, 600);
  const ticks = Math.max(10, Math.ceil(duration));

  // ===== Pre-bucket segments by layer (avoids N×M filter on every render) =====
  const segmentsByLayer = useMemo(() => {
    const buckets: Segment[][] = Array.from({ length: layerCount }, () => []);
    for (const s of segments) {
      if (s.layer >= 0 && s.layer < layerCount) buckets[s.layer].push(s);
    }
    return buckets;
  }, [segments, layerCount]);

  // Stable Set of dragging ids — avoids creating a new Set per LayerRow per frame.
  const draggingIds = useMemo(
    () => (dragPreview ? new Set(dragPreview.items.map((i) => i.id)) : null),
    [dragPreview],
  );
  const previewItemsByLayer = useMemo(() => {
    const map = new Map<number, { id: string; layer: number; start: number; length: number }[]>();
    if (dragPreview) {
      for (const it of dragPreview.items) {
        const arr = map.get(it.layer) ?? [];
        arr.push(it);
        map.set(it.layer, arr);
      }
    }
    return map;
  }, [dragPreview]);
  const EMPTY_PREVIEW: { id: string; layer: number; start: number; length: number }[] = [];

  const layerRows = useMemo(
    () =>
      Array.from({ length: layerCount }).map((_, layerIdx) => (
        <LayerRow
          key={layerIdx}
          layerIdx={layerIdx}
          segs={segmentsByLayer[layerIdx] ?? []}
          pxPerSec={PX_PER_SEC}
          totalPx={trackPxWidth}
          selectedIds={selectedIds}
          toggleSelect={toggleSelect}
          trim={trim}
          dragPreviewItems={previewItemsByLayer.get(layerIdx) ?? EMPTY_PREVIEW}
          dragInsertAt={dragPreview && dragPreview.insertLayer === layerIdx ? dragPreview.insertAt : null}
          dragRippleLength={dragPreview && dragPreview.insertLayer === layerIdx ? dragPreview.rippleLength : 0}
          draggingIds={draggingIds}
          onDragUpdate={updateDragPreview}
          onDragCommit={commitDrag}
          onDragCancel={cancelDrag}
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layerCount, segmentsByLayer, PX_PER_SEC, trackPxWidth, selectedIds, dragPreview, draggingIds, previewItemsByLayer],
  );

  const onRulerMouseDown = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const scroll = timelineScrollRef.current?.scrollLeft ?? 0;
    const fromX = (cx: number) => seek((cx - rect.left + scroll) / PX_PER_SEC);
    fromX(e.clientX);
    const move = (ev: MouseEvent) => fromX(ev.clientX);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ===== Rubber-band selection on empty track area =====
  const onTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start rubber-band if clicking on the track background (not on a segment)
    const target = e.target as HTMLElement;
    if (target.closest("[data-segment]") || target.closest("[data-handle]") || target.dataset.handle) return;
    if (target.closest("[data-ruler]")) return;

    const container = timelineContentRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const startX = e.clientX - containerRect.left;
    const startY = e.clientY - containerRect.top;

    isRubberBanding.current = true;
    setRubberBand({ startX, startY, endX: startX, endY: startY });

    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      setSelectedIds(new Set());
    }

    const move = (ev: MouseEvent) => {
      const endX = ev.clientX - containerRect.left;
      const endY = ev.clientY - containerRect.top;
      setRubberBand({ startX, startY, endX, endY });

      // Calculate which segments intersect the rubber band
      const rbLeft = (Math.min(startX, endX) - 80) / PX_PER_SEC;
      const rbRight = (Math.max(startX, endX) - 80) / PX_PER_SEC;
      const layerHeight = 44; // approximate row height
      const rulerHeight = 28;
      const rbTopLayer = Math.floor((Math.min(startY, endY) - rulerHeight) / layerHeight);
      const rbBottomLayer = Math.floor((Math.max(startY, endY) - rulerHeight) / layerHeight);

      const newSel = new Set<string>();
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
        selectedIds.forEach((id) => newSel.add(id));
      }
      for (const s of segments) {
        const sEnd = endOf(s);
        if (s.start < rbRight && sEnd > rbLeft && s.layer >= rbTopLayer && s.layer <= rbBottomLayer) {
          newSel.add(s.id);
        }
      }
      setSelectedIds(newSel);
    };

    const up = () => {
      isRubberBanding.current = false;
      setRubberBand(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [PX_PER_SEC, segments, selectedIds]);

  // Set marker in at current time
  const setMarkerInAtTime = () => {
    setMarkerIn(time);
    toast.success(`Marcador IN → ${fmt(time)}`);
  };
  const setMarkerOutAtTime = () => {
    setMarkerOut(time);
    toast.success(`Marcador OUT → ${fmt(time)}`);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "i" || e.key === "I") { setMarkerIn(time); toast.success(`IN → ${fmt(time)}`); }
      if (e.key === "o" || e.key === "O") { setMarkerOut(time); toast.success(`OUT → ${fmt(time)}`); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.size > 0) deleteSelected();
      }
      if (e.key === " ") { e.preventDefault(); toggle(); }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [time, selectedIds]); // eslint-disable-line

  const chapters = segments
    .filter((s) => s.kind === "slide")
    .sort((a, b) => a.start - b.start)
    .map((s) => ({ slideId: s.id, time: s.start, end: endOf(s), slide: { name: s.label } }));

  const hasMarkerRegion = markerIn !== null && markerOut !== null;
  const markerLo = hasMarkerRegion ? Math.min(markerIn!, markerOut!) : 0;
  const markerHi = hasMarkerRegion ? Math.max(markerIn!, markerOut!) : 0;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setView("home")} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          <button onClick={() => setChaptersOpen(true)} className="flex items-center gap-1.5 rounded-md bg-card px-3 py-1.5 text-sm ring-1 ring-border transition-colors hover:bg-muted">
            <List className="h-4 w-4" /> Capítulos
          </button>
          <button
            onClick={() => setRecordOpen(true)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              recordOpen
                ? "bg-[hsl(var(--rec))] text-white"
                : "bg-card ring-1 ring-border hover:bg-muted"
            }`}
          >
            <Video className="h-4 w-4" /> Gravar nova cena
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-card px-3 py-1.5 text-sm ring-1 ring-border transition-colors hover:bg-muted">
            <Upload className="h-4 w-4" /> Mídia
            <input type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={(e) => onUploadMedia(e.target.files)} />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-card px-3 py-1.5 text-sm ring-1 ring-border transition-colors hover:bg-muted">
            <Presentation className="h-4 w-4" /> PowerPoint
            <input
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="hidden"
              onChange={(e) => { onUploadPptx(e.target.files); e.currentTarget.value = ""; }}
            />
          </label>
        </div>
        <button onClick={() => toast.success("Projeto salvo")} className="flex items-center gap-1.5 rounded-md bg-[hsl(var(--rec))] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90">
          <Save className="h-4 w-4" /> Salvar
        </button>
      </header>

      {chaptersOpen && <ChaptersPanel onClose={() => setChaptersOpen(false)} segments={chapters} onSeek={seek} />}

      {/* Preview + inline record panel side-by-side */}
      <div className="flex flex-1 items-stretch gap-4 px-6 pb-4 pt-4 min-h-0">
        {recordOpen && (
          <RecordSidebar
            open={recordOpen}
            onClose={() => setRecordOpen(false)}
            playheadTime={time}
            onRecordingChange={setIsRecording}
            hasRealBase={hasRealBaseAt(time)}
            onScreenShareChange={(stream, role) => {
              setLiveScreenStream(stream);
              setLiveScreenRole(role);
            }}
          />
        )}
        <div className="flex flex-1 min-w-0">
          <PreviewArea
            videoRef={videoRef}
            
            activeSegments={active}
            mainVideo={mainVideo}
            screenVideo={screenVideo}
            liveScreenStream={liveScreenStream}
            liveScreenRole={liveScreenRole}
            isRecording={isRecording}
            updateTransform={(id, t) => {
              setSegments((prev) => prev.map((s) => s.id === id ? { ...s, transform: { ...tf(s), ...t } } : s));
            }}
            selectedIds={selectedIds}
            onSelect={(id) => setSelectedIds(new Set([id]))}
          />
        </div>
      </div>

      {/* hidden audio elements */}
      {segments.filter((s) => s.kind === "audio").map((s) => (
        <audio key={s.id} ref={(el) => { audioRefs.current[s.id] = el; }} src={s.mediaUrl} preload="metadata" />
      ))}

      {/* player bar */}
      <div className="px-6">
        <div className="relative h-1 w-full cursor-pointer rounded-full bg-muted" onMouseDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const fromX = (cx: number) => seek(((cx - r.left) / r.width) * duration);
          fromX(e.clientX);
          const move = (ev: MouseEvent) => fromX(ev.clientX);
          const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}>
          <div className="absolute left-0 top-0 h-1 rounded-full bg-[hsl(var(--rec))] transition-[width] duration-75" style={{ width: `${(time / duration) * 100}%` }} />
          <div className="absolute -top-1 h-3 w-3 -translate-x-1/2 rounded-full bg-[hsl(var(--rec))] transition-[left] duration-75" style={{ left: `${(time / duration) * 100}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => seek(0)} className="rounded-full p-1.5 transition-colors hover:bg-muted"><SkipBack className="h-4 w-4" /></button>
            <button onClick={toggle} className="rounded-full bg-primary p-1.5 text-primary-foreground transition-all hover:bg-primary/90 hover:scale-105 active:scale-95">
              {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <button onClick={() => seek(duration)} className="rounded-full p-1.5 transition-colors hover:bg-muted"><SkipForward className="h-4 w-4" /></button>
          </div>
          <div className="text-xs text-muted-foreground">{mainSlide?.label ?? "—"}</div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Volume2 className="h-4 w-4" />
            <Maximize2 className="h-4 w-4" />
            <span className="font-mono tabular-nums">{fmt(time)} / {fmt(duration)}</span>
          </div>
        </div>
      </div>

      {/* edit toolbar */}
      <div className="mt-2 flex items-center gap-2 px-4 flex-wrap">
        <button
          onClick={undo}
          disabled={!canUndo}
          title="Desfazer (Ctrl+Z)"
          aria-label="Desfazer"
          className="flex items-center justify-center rounded-md bg-card p-1.5 ring-1 ring-border transition-all hover:bg-muted disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          title="Refazer (Ctrl+Shift+Z)"
          aria-label="Refazer"
          className="flex items-center justify-center rounded-md bg-card p-1.5 ring-1 ring-border transition-all hover:bg-muted disabled:opacity-40"
        >
          <Redo2 className="h-4 w-4" />
        </button>
        <div className="h-4 w-px bg-border mx-1" />
        <button
          onClick={() => {
            if (hasMarkerRegion) {
              deleteMarkerRegion();
              return;
            }
            const span = Math.min(3, Math.max(0.5, duration - time));
            const inT = Math.max(0, time);
            const outT = Math.min(duration, time + span);
            setMarkerIn(inT);
            setMarkerOut(outT);
            toast.success("Ajuste os marcadores IN/OUT e clique em Cortar novamente");
          }}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${hasMarkerRegion ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
          title={hasMarkerRegion ? "Cortar a região marcada" : "Definir marcadores IN/OUT"}
        >
          <Scissors className="h-3.5 w-3.5" /> {hasMarkerRegion ? "Cortar região" : "Cortar"}
        </button>
        <button onClick={deleteSelected} disabled={selectedIds.size === 0} className="flex items-center gap-1.5 rounded-md bg-card px-2.5 py-1.5 text-xs ring-1 ring-border transition-all hover:bg-muted disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" /> Apagar{selectedIds.size > 1 ? ` (${selectedIds.size})` : ""}
        </button>
        {selectedIds.size > 0 && (
          <button onClick={clearSelection} className="rounded-md bg-card px-2.5 py-1.5 text-xs ring-1 ring-border transition-all hover:bg-muted">
            Limpar seleção
          </button>
        )}

        {hasMarkerRegion && (
          <>
            <div className="h-4 w-px bg-border mx-1" />
            <span className="font-mono text-[10px] text-muted-foreground">
              {fmt(markerLo)} → {fmt(markerHi)}
            </span>
            <button onClick={() => { setMarkerIn(null); setMarkerOut(null); }} className="rounded-md bg-card px-2.5 py-1.5 text-xs ring-1 ring-border transition-all hover:bg-muted">
              Cancelar
            </button>
          </>
        )}

        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} className="rounded-md px-2 py-1 transition-colors hover:bg-muted">−</button>
          Zoom {Math.round(zoom * 100)}%
          <button onClick={() => setZoom((z) => Math.min(4, z + 0.2))} className="rounded-md px-2 py-1 transition-colors hover:bg-muted">+</button>
        </div>
      </div>

      {/* Resizable splitter */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = timelineH;
          const move = (ev: MouseEvent) => {
            const dy = ev.clientY - startY;
            setTimelineH(Math.max(120, Math.min(600, startH - dy)));
          };
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            document.body.style.cursor = "";
          };
          document.body.style.cursor = "row-resize";
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
        className="group relative h-1.5 cursor-row-resize bg-transparent hover:bg-primary/20 transition-colors shrink-0"
        title="Arraste para redimensionar"
      >
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-1 w-12 rounded-full bg-border group-hover:bg-primary/60 transition-colors" />
      </div>

      {/* Timeline */}
      <div ref={timelineScrollRef} style={{ height: timelineH }} className="overflow-auto bg-[hsl(var(--timeline-bg))] px-2 pb-4 scrollbar-thin select-none shrink-0">
        <div ref={timelineContentRef} className="relative" style={{ width: trackPxWidth + 80 }} onMouseDown={onTimelineMouseDown}>
          {/* Ruler */}
          <div className="flex" data-ruler>
            <div className="w-20 shrink-0" />
            <div onMouseDown={onRulerMouseDown} data-ruler className="relative cursor-pointer select-none border-b border-border/60 text-[10px] text-muted-foreground" style={{ width: trackPxWidth }}>
              <div className="flex">
                {Array.from({ length: ticks }).map((_, i) => (
                  <div key={i} style={{ width: PX_PER_SEC }} className="border-l border-border/40 px-1 py-1">{fmt(i)}</div>
                ))}
              </div>
            </div>
          </div>

          {/* Layers */}
          {layerRows}

          {/* Marker region highlight */}
          {hasMarkerRegion && (
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: 80 + markerLo * PX_PER_SEC,
                width: (markerHi - markerLo) * PX_PER_SEC,
                background: "linear-gradient(180deg, hsla(0,70%,50%,0.12) 0%, hsla(0,70%,50%,0.06) 100%)",
                borderLeft: "2px solid hsl(142, 71%, 45%)",
                borderRight: "2px solid hsl(0, 84%, 60%)",
              }}
            />
          )}

          {/* Marker IN */}
          {markerIn !== null && (
            <MarkerHandle
              position={80 + markerIn * PX_PER_SEC}
              color="hsl(142, 71%, 45%)"
              label="IN"
              onDrag={(dx) => setMarkerIn((prev) => Math.max(0, Math.min(duration, (prev ?? 0) + dx / PX_PER_SEC)))}
            />
          )}

          {/* Marker OUT */}
          {markerOut !== null && (
            <MarkerHandle
              position={80 + markerOut * PX_PER_SEC}
              color="hsl(0, 84%, 60%)"
              label="OUT"
              onDrag={(dx) => setMarkerOut((prev) => Math.max(0, Math.min(duration, (prev ?? 0) + dx / PX_PER_SEC)))}
            />
          )}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-px cursor-grab active:cursor-grabbing"
            style={{ left: 80 + time * PX_PER_SEC, background: "hsl(var(--rec))", transition: playing ? "none" : "left 0.05s ease-out" }}
            onMouseDown={(e) => {
              e.preventDefault();
              const scrollEl = timelineScrollRef.current;
              const startScroll = scrollEl?.scrollLeft ?? 0;
              const startX = e.clientX;
              const startTime = time;
              const move = (ev: MouseEvent) => {
                const dx = ev.clientX - startX + ((scrollEl?.scrollLeft ?? 0) - startScroll);
                seek(startTime + dx / PX_PER_SEC);
              };
              const up = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
            }}
          >
            <div className="absolute -top-0.5 -left-[6px] w-[13px] h-[13px] rounded-sm rotate-45 cursor-grab active:cursor-grabbing" style={{ background: "hsl(var(--rec))" }} />
          </div>

          {/* Rubber band selection rectangle */}
          {rubberBand && (
            <div
              className="absolute pointer-events-none rounded border border-primary/60 z-50"
              style={{
                left: Math.min(rubberBand.startX, rubberBand.endX),
                top: Math.min(rubberBand.startY, rubberBand.endY),
                width: Math.abs(rubberBand.endX - rubberBand.startX),
                height: Math.abs(rubberBand.endY - rubberBand.startY),
                background: "hsla(var(--primary), 0.08)",
              }}
            />
          )}
        </div>
      </div>

      {/* Hint bar */}
      <div className="flex items-center gap-4 border-t border-border bg-card/50 px-4 py-1.5 text-[10px] text-muted-foreground">
        <span><Scissors className="h-3 w-3 inline" /> Cortar: define IN/OUT, arraste para ajustar</span>
        <span><kbd className="rounded bg-muted px-1 py-0.5 text-[9px] font-mono">I</kbd>/<kbd className="rounded bg-muted px-1 py-0.5 text-[9px] font-mono">O</kbd> Mover IN/OUT para o cursor</span>
        <span><kbd className="rounded bg-muted px-1 py-0.5 text-[9px] font-mono">Ctrl</kbd>+Click Seleção múltipla</span>
        <span><MousePointer2 className="h-3 w-3 inline" /> Arraste para selecionar</span>
        <span><kbd className="rounded bg-muted px-1 py-0.5 text-[9px] font-mono">Space</kbd> Play/Pause</span>
        <span><kbd className="rounded bg-muted px-1 py-0.5 text-[9px] font-mono">Del</kbd> Apagar seleção</span>
      </div>


      {/* Subtle blocker over the timeline area while REC (keeps preview clickable so user sees the slide) */}
      {isRecording && (
        <div className="pointer-events-auto absolute bottom-0 left-0 right-0 top-1/2 z-30 cursor-not-allowed bg-background/30 backdrop-blur-[1px] animate-fade-in" />
      )}
    </div>
  );
}

// ===== Draggable Marker Handle =====
function MarkerHandle({ position, color, label, onDrag }: {
  position: number;
  color: string;
  label: string;
  onDrag: (deltaPx: number) => void;
}) {
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let last = e.clientX;
    const move = (ev: MouseEvent) => {
      const d = ev.clientX - last;
      last = ev.clientX;
      onDrag(d);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      className="absolute top-0 bottom-0 w-0.5 cursor-ew-resize z-30"
      style={{ left: position, background: color }}
      onMouseDown={onDown}
    >
      <div
        className="absolute -top-1 -left-[10px] flex items-center justify-center w-[21px] h-4 rounded-sm text-[8px] font-bold text-white cursor-ew-resize select-none"
        style={{ background: color }}
      >
        {label}
      </div>
      <div
        className="absolute -bottom-1 -left-[4px] w-[9px] h-[9px] rotate-45"
        style={{ background: color }}
      />
    </div>
  );
}

// ===== Preview Area =====
function PreviewArea({
  videoRef,
  activeSegments,
  mainVideo,
  screenVideo,
  liveScreenStream,
  liveScreenRole,
  isRecording,
  updateTransform,
  selectedIds,
  onSelect,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  
  activeSegments: Segment[];
  mainVideo: Segment | undefined;
  screenVideo: Segment | undefined;
  liveScreenStream: MediaStream | null;
  liveScreenRole: "base" | "overlay";
  isRecording: boolean;
  updateTransform: (id: string, t: Partial<Transform>) => void;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  const liveScreenRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = liveScreenRef.current;
    if (el && liveScreenStream) {
      el.srcObject = liveScreenStream;
      el.play().catch(() => {});
    } else if (el) {
      el.srcObject = null;
    }
  }, [liveScreenStream]);

  useEffect(() => {
    const el = screenVideoRef.current;
    if (el && screenVideo?.mediaUrl) {
      if (!el.src.includes(screenVideo.mediaUrl)) el.src = screenVideo.mediaUrl;
    } else if (el) {
      el.removeAttribute("src");
    }
  }, [screenVideo?.mediaUrl]);

  // Sort: highest layer index first (back), lower layers in front (per user's choice).
  // i.e. layer 0 should be on top, so we render in DESCENDING order so layer 0 paints last.
  const renderOrder = [...activeSegments]
    .filter((s) => s.kind !== "audio")
    .sort((a, b) => b.layer - a.layer);

  const maxLayer = activeSegments.reduce((m, s) => Math.max(m, s.layer), 0);

  return (
    <div className="flex flex-1 items-center justify-center">
      {/* 16:9 stage, no black background */}
      <div
        ref={stageRef}
        className="relative aspect-video w-full max-h-full max-w-full overflow-hidden rounded-2xl ring-1 ring-white/5"
        style={{ background: "transparent" }}
      >
        {renderOrder.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Sem conteúdo ativo
          </div>
        )}

        {renderOrder.map((s) => {
          const t = tf(s);
          const z = (maxLayer - s.layer) + 1;
          const isLiveScreen = liveScreenStream && s.id === "__livescreen__";
          // Determine media element
          let inner: React.ReactNode = null;
          if (s.kind === "slide" && s.slideUrl) {
            inner = <img src={s.slideUrl} alt={s.label} className="h-full w-full object-cover" draggable={false} />;
          } else if (s.kind === "slide") {
            inner = <div className="flex h-full w-full items-center justify-center bg-muted/30 text-xs text-muted-foreground">{s.label}</div>;
          } else if (s.kind === "image" && s.mediaUrl) {
            inner = <img src={s.mediaUrl} alt={s.label} className="h-full w-full object-contain" draggable={false} />;
          } else if (s.kind === "video" && s.source === "screen") {
            inner = <video ref={screenVideoRef} className="h-full w-full object-cover" muted />;
          } else if (s.kind === "video") {
            inner = <video ref={videoRef} className="h-full w-full object-cover" muted />;
          }

          const selected = selectedIds.has(s.id);
          return (
            <DraggableLayer
              key={s.id}
              transform={t}
              z={z}
              selected={selected}
              onSelect={() => onSelect(s.id)}
              onChange={(nt) => updateTransform(s.id, nt)}
              stageRef={stageRef}
              label={s.label}
            >
              {inner}
            </DraggableLayer>
          );
        })}

        {/* Live screen share overlay (not in segments yet) */}
        {liveScreenStream && (
          <div
            className="pointer-events-none absolute overflow-hidden rounded-xl ring-2 ring-amber-500/60"
            style={
              liveScreenRole === "base"
                ? { left: 0, top: 0, width: "100%", height: "100%", zIndex: 0 }
                : { right: 16, top: 16, width: 320, height: 180, zIndex: 999 }
            }
          >
            <video ref={liveScreenRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableLayer({
  transform,
  z,
  selected,
  onSelect,
  onChange,
  stageRef,
  label,
  children,
}: {
  transform: Transform;
  z: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (t: Partial<Transform>) => void;
  stageRef: React.RefObject<HTMLDivElement>;
  label: string;
  children: React.ReactNode;
}) {
  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    const startX = e.clientX, startY = e.clientY;
    const sx = transform.x, sy = transform.y;
    const move = (ev: MouseEvent) => {
      const dx = ((ev.clientX - startX) / stage.width) * 100;
      const dy = ((ev.clientY - startY) / stage.height) * 100;
      onChange({
        x: Math.max(-50, Math.min(150 - transform.w, sx + dx)),
        y: Math.max(-50, Math.min(150 - transform.h, sy + dy)),
      });
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onResize = (corner: "br") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    const startX = e.clientX, startY = e.clientY;
    const sw = transform.w, sh = transform.h;
    const move = (ev: MouseEvent) => {
      const dw = ((ev.clientX - startX) / stage.width) * 100;
      const dh = ((ev.clientY - startY) / stage.height) * 100;
      onChange({
        w: Math.max(5, Math.min(200, sw + dw)),
        h: Math.max(5, Math.min(200, sh + dh)),
      });
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      onMouseDown={onDown}
      title={label}
      className={`absolute cursor-grab active:cursor-grabbing ${selected ? "outline outline-2 outline-primary" : "outline outline-1 outline-transparent hover:outline-primary/40"}`}
      style={{
        left: `${transform.x}%`,
        top: `${transform.y}%`,
        width: `${transform.w}%`,
        height: `${transform.h}%`,
        zIndex: z,
      }}
    >
      {children}
      {selected && (
        <div
          data-handle="1"
          onMouseDown={onResize("br")}
          className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-primary ring-2 ring-background"
        />
      )}
    </div>
  );
}

const KIND_STYLE: Record<Kind, { color: string; Icon: any }> = {
  video: { color: "bg-primary/30 ring-primary/60", Icon: Video },
  slide: { color: "bg-emerald-500/30 ring-emerald-500/60", Icon: ImageIcon },
  audio: { color: "bg-fuchsia-500/25 ring-fuchsia-500/50", Icon: Music },
  image: { color: "bg-amber-500/30 ring-amber-500/60", Icon: Film },
};

const LayerRow = memo(function LayerRow({ layerIdx, segs, pxPerSec, totalPx, selectedIds, toggleSelect, trim, dragPreviewItems, dragInsertAt, dragRippleLength, draggingIds, onDragUpdate, onDragCommit, onDragCancel }: {
  layerIdx: number;
  segs: Segment[];
  pxPerSec: number;
  totalPx: number;
  selectedIds: Set<string>;
  toggleSelect: (id: string, additive: boolean) => void;
  trim: (id: string, edge: "start" | "end", deltaSec: number) => void;
  dragPreviewItems: { id: string; layer: number; start: number; length: number }[];
  dragInsertAt: number | null;
  dragRippleLength: number;
  draggingIds: Set<string> | null;
  onDragUpdate: (id: string, proposedStart: number, proposedLayer: number) => void;
  onDragCommit: () => void;
  onDragCancel: () => void;
}) {
  return (
    <div className="flex items-stretch">
      <div className="flex w-20 shrink-0 items-center gap-1.5 py-2 text-xs text-muted-foreground">
        <Plus className="h-3 w-3 opacity-50" /> Camada {layerIdx + 1}
      </div>
      <div
        className="relative my-1 h-9 rounded bg-[hsl(var(--track-bg))] ring-1 ring-border/50"
        style={{ width: totalPx }}
      >
        {segs.map((s) => {
          const isDragging = !!draggingIds?.has(s.id);
          // Ripple preview: when dragging, shift later clips on the insert layer
          // by rippleLength so they slide smoothly out of the way.
          let previewStart = s.start;
          let isRippled = false;
          if (
            !isDragging &&
            dragInsertAt !== null &&
            s.start >= dragInsertAt - 1e-3
          ) {
            previewStart = s.start + dragRippleLength;
            isRippled = true;
          }
          const left = previewStart * pxPerSec;
          const width = (s.srcEnd - s.srcStart) * pxPerSec;
          const selected = selectedIds.has(s.id);
          const style = KIND_STYLE[s.kind];
          // Subtle stagger: clips farther from the insertion point animate
          // slightly later, producing a wave-like ripple feel (capped low so
          // the timeline still feels responsive).
          const staggerMs =
            dragInsertAt !== null
              ? Math.min(90, Math.max(0, (s.start - dragInsertAt)) * 12)
              : 0;
          return (
            <div
              key={s.id}
              data-segment
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).dataset.handle) return;
                e.stopPropagation();
                const additive = e.shiftKey || e.metaKey || e.ctrlKey;
                if (additive || !selected) toggleSelect(s.id, additive);
                const startX = e.clientX;
                const startY = e.clientY;
                const startStart = s.start;
                const startLayer = s.layer;
                let moved = false;
                let rafId = 0;
                let pendingX = 0;
                let pendingY = 0;
                const flush = () => {
                  rafId = 0;
                  const newStart = Math.max(0, startStart + pendingX / pxPerSec);
                  const layerDelta = Math.round(pendingY / 44);
                  const newLayer = Math.max(0, startLayer + layerDelta);
                  onDragUpdate(s.id, newStart, newLayer);
                };
                const move = (ev: MouseEvent) => {
                  const dx = ev.clientX - startX;
                  const dy = ev.clientY - startY;
                  if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                  moved = true;
                  pendingX = dx;
                  pendingY = dy;
                  if (!rafId) rafId = requestAnimationFrame(flush);
                };
                const up = () => {
                  window.removeEventListener("mousemove", move);
                  window.removeEventListener("mouseup", up);
                  if (rafId) cancelAnimationFrame(rafId);
                  if (moved) onDragCommit(); else onDragCancel();
                };
                window.addEventListener("mousemove", move, { passive: true });
                window.addEventListener("mouseup", up);
              }}
              className={`group absolute inset-y-0.5 cursor-grab overflow-hidden rounded ring-1 ${style.color} ${selected ? "outline outline-2 outline-[hsl(var(--rec))] z-10" : "hover:brightness-110"} ${isDragging ? "opacity-40" : ""} ${isRippled ? "ring-primary/40" : ""}`}
              style={{
                // Use transform for GPU-accelerated movement instead of `left`.
                left: 0,
                width,
                transform: `translate3d(${left}px, 0, 0)`,
                transition: isDragging
                  ? "none"
                  : "transform 320ms cubic-bezier(0.16, 1, 0.3, 1), width 200ms ease, opacity 180ms ease",
                transitionDelay: isDragging ? "0ms" : `${staggerMs}ms`,
                willChange: dragInsertAt !== null ? "transform" : "auto",
                contain: "layout paint",
              }}
            >
              <div className="flex h-full items-center gap-1 px-1.5 text-[10px] text-foreground/90">
                <style.Icon className="h-3 w-3 opacity-70 shrink-0" />
                <span className="truncate">{s.label}</span>
              </div>
              <Handle onDrag={(d) => trim(s.id, "start", d / pxPerSec)} side="left" />
              <Handle
                onDrag={(d) => trim(s.id, "end", d / pxPerSec)}
                side="right"
                disabled={!isStretchable(s) && s.srcEnd >= (s.mediaDuration ?? Infinity) - 1e-3}
                title={isStretchable(s) ? "Esticar" : `Máx: ${(s.mediaDuration ?? 0).toFixed(1)}s`}
              />
            </div>
          );
        })}

        {/* Ghost previews of dragged clips on this layer */}
        {dragPreviewItems.map((it) => {
          const ghostLeft =
            dragInsertAt !== null
              ? dragInsertAt * pxPerSec
              : it.start * pxPerSec;
          return (
            <div
              key={`ghost-${it.id}`}
              className="pointer-events-none absolute inset-y-0.5 rounded border border-dashed border-primary/60 bg-primary/10 z-20"
              style={{
                left: 0,
                width: it.length * pxPerSec,
                transform: `translate3d(${ghostLeft}px, 0, 0)`,
                transition:
                  "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), width 180ms ease",
                boxShadow: "0 0 0 1px hsl(var(--primary) / 0.15) inset",
                willChange: "transform",
              }}
            />
          );
        })}

        {/* Insertion indicator — soft dotted vertical line on the next clip's edge */}
        {dragInsertAt !== null && (
          <div
            className="pointer-events-none absolute inset-y-1 z-30"
            style={{
              left: 0,
              width: 2,
              transform: `translate3d(${(dragInsertAt + dragRippleLength) * pxPerSec - 1}px, 0, 0)`,
              backgroundImage:
                "linear-gradient(to bottom, hsl(var(--primary) / 0.85) 50%, transparent 50%)",
              backgroundSize: "2px 5px",
              backgroundRepeat: "repeat-y",
              borderRadius: 2,
              filter: "drop-shadow(0 0 4px hsl(var(--primary) / 0.45))",
              transition: "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "transform",
            }}
          />
        )}
      </div>
    </div>
  );
});

function Handle({ side, onDrag, disabled, title }: { side: "left" | "right"; onDrag: (deltaPx: number) => void; disabled?: boolean; title?: string }) {
  const onDown = (e: React.MouseEvent) => {
    if (disabled) return;
    e.stopPropagation();
    let last = e.clientX;
    const move = (ev: MouseEvent) => { const d = ev.clientX - last; last = ev.clientX; onDrag(d); };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <div data-handle="1" onMouseDown={onDown} title={title}
      className={`absolute inset-y-0 w-1.5 ${disabled ? "cursor-not-allowed bg-foreground/20" : "cursor-ew-resize bg-foreground/40"} opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${side === "left" ? "left-0" : "right-0"}`} />
  );
}
