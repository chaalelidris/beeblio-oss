"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Check,
  Quote,
  FileText,
  Sparkles,
  AlertTriangle,
  AlertCircle,
  X,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileSearch,
  GripHorizontal,
  RotateCcw,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  SkipForward,
  Circle,
} from "lucide-react";
import type { CitationFindMatch } from "@/lib/citation-finder";
import { OPEN_WORKSPACE_FILE_EVENT } from "@/lib/chat-context";
import {
  calculateCitationPlacement,
  checkParagraphCitationHygiene,
} from "@/lib/citation-placement";
import { cn } from "@/lib/utils";

export const SCANNING_STEPS = [
  {
    id: "bib",
    title: "Reading project bibliography (references.bib)",
    detail: "Parsing entries, abstracts, and metadata in references.bib",
    short: "Reading bibliography…",
    durationMs: 800,
  },
  {
    id: "claim",
    title: "Stage A: Scientific Claim Decomposition",
    detail: "Extracting main claim, subclaims, metrics, units, and causal markers",
    short: "Decomposing claim…",
    durationMs: 1200,
  },
  {
    id: "retrieval",
    title: "Stage B: Evidence Passage Retrieval",
    detail: "Scanning PDFs, abstracts, and vector chunks preserving provenance",
    short: "Retrieving passages…",
    durationMs: 2500,
  },
  {
    id: "rerank",
    title: "Stage C & E: Alignment & Consistency Checks",
    detail: "Validating numerical metrics, polarity, units, and reranking passages",
    short: "Checking consistency…",
    durationMs: 2000,
  },
  {
    id: "verification",
    title: "Stage D & F: Claim–Evidence Entailment Verification",
    detail: "Evaluating factual entailment, supported subclaims, and decision",
    short: "Verifying evidence…",
    durationMs: 3500,
  },
] as const;

export type CitationApprovalState = {
  isOpen: boolean;
  text: string;
  range: { from: number; to: number };
  draftFilePath: string;
  paragraphText?: string;
  existingCitationKeys?: string[];
  status: "searching" | "found" | "not_found" | "already_cited" | "error";
  match?: CitationFindMatch;
  matches?: CitationFindMatch[];
  error?: string;
  alreadyCitedInParagraph?: boolean;
  alreadyCitedKey?: string;
  auditQueue?: {
    claims: Array<{
      id: string;
      text: string;
      from: number;
      to: number;
      signal?: string;
      category?: "statistic" | "finding" | "literature" | "empirical" | "consensus";
      requiresMultipleSources?: boolean;
      q1Guideline?: string;
      paragraphIndex?: number;
      existingCitationKeys?: string[];
      partOfStudySummary?: boolean;
      precedingText?: string;
      sectionHeading?: string;
      paragraphText?: string;
    }>;
    currentIndex: number;
    approvedCount: number;
    skippedCount: number;
    completed?: boolean;
  };
};

function CitationConnectorLine({
  cardRef,
  position,
  isDragging,
  targetText,
  minimized,
}: {
  cardRef: React.RefObject<HTMLElement | null>;
  position: { x: number; y: number } | null;
  isDragging: boolean;
  targetText?: string;
  minimized: boolean;
}) {
  const [coords, setCoords] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    orientation: "bottom" | "top" | "side";
  } | null>(null);

  const updateLine = useCallback(() => {
    // 1. Locate the active sentence in the document editor
    let sentenceRect: { left: number; right: number; top: number; bottom: number; height: number } | null = null;
    let firstRect: { left: number; right: number; top: number; bottom: number; height: number } | null = null;
    let lastRect: { left: number; right: number; top: number; bottom: number; height: number } | null = null;

    const highlightEl = document.querySelector(".beeblio-citation-dock-highlight");
    if (highlightEl) {
      const rects = highlightEl.getClientRects();
      if (rects.length > 0) {
        firstRect = rects[0];
        lastRect = rects[rects.length - 1];
        const b = highlightEl.getBoundingClientRect();
        sentenceRect = {
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          height: b.height,
        };
      }
    }

    if (!sentenceRect && targetText && targetText.trim().length > 5) {
      const snippet = targetText.trim().slice(0, 30);
      const paragraphs = document.querySelectorAll(".tiptap p, .tiptap blockquote");
      for (const p of Array.from(paragraphs)) {
        if (p.textContent && p.textContent.includes(snippet)) {
          const b = p.getBoundingClientRect();
          sentenceRect = {
            left: b.left,
            right: b.right,
            top: b.top,
            bottom: b.bottom,
            height: b.height,
          };
          firstRect = b;
          lastRect = b;
          break;
        }
      }
    }

    if (!sentenceRect) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const rects = range.getClientRects();
        if (rects.length > 0) {
          firstRect = rects[0];
          lastRect = rects[rects.length - 1];
          const b = range.getBoundingClientRect();
          sentenceRect = {
            left: b.left,
            right: b.right,
            top: b.top,
            bottom: b.bottom,
            height: b.height,
          };
        }
      }
    }

    if (!sentenceRect || !lastRect || !firstRect) {
      setCoords(null);
      return;
    }

    // If the sentence is scrolled out of view, hide the line gracefully
    if (sentenceRect.bottom < 20 || sentenceRect.top > window.innerHeight - 20) {
      setCoords(null);
      return;
    }

    // 2. Locate the floating dock card/pill
    let dockLeft = 0;
    let dockTop = 0;
    let dockRight = 0;
    let dockBottom = 0;

    if (position) {
      const width = cardRef.current?.offsetWidth || (minimized ? 280 : 480);
      const height = cardRef.current?.offsetHeight || (minimized ? 40 : 360);
      dockLeft = position.x;
      dockTop = position.y;
      dockRight = dockLeft + width;
      dockBottom = dockTop + height;
    } else if (cardRef.current) {
      const r = cardRef.current.getBoundingClientRect();
      dockLeft = r.left;
      dockTop = r.top;
      dockRight = r.right;
      dockBottom = r.bottom;
    } else {
      setCoords(null);
      return;
    }

    // 3. Determine anchor points based on relative orientation
    const sentenceCenterX = (sentenceRect.left + sentenceRect.right) / 2;
    const isVerticallyAbove = dockBottom <= sentenceRect.top + 24;
    const isVerticallyBelow = dockTop >= sentenceRect.bottom - 24;
    const isHorizontallyAligned = dockRight >= sentenceRect.left - 90 && dockLeft <= sentenceRect.right + 90;

    let x1 = 0;
    let y1 = 0;
    let x2 = 0;
    let y2 = 0;
    let orientation: "bottom" | "top" | "side" = "side";

    if (
      isVerticallyAbove &&
      (isHorizontallyAligned || Math.abs(dockBottom - sentenceRect.top) >= Math.abs(dockLeft - sentenceRect.right))
    ) {
      // DOCK IS ON TOP OF THE TEXT -> Link the line in the BOTTOM of the dock!
      orientation = "bottom";
      const cornerInset = minimized ? 20 : 36;
      x2 = Math.min(Math.max(dockLeft + cornerInset, sentenceCenterX), dockRight - cornerInset);
      y2 = dockBottom;

      y1 = sentenceRect.top - 2;
      x1 = Math.min(Math.max(sentenceRect.left + 10, x2), sentenceRect.right - 10);
    } else if (
      isVerticallyBelow &&
      (isHorizontallyAligned || Math.abs(dockTop - sentenceRect.bottom) >= Math.abs(dockLeft - sentenceRect.right))
    ) {
      // Dock is below the text -> Link the line in the TOP of the dock
      orientation = "top";
      const cornerInset = minimized ? 20 : 36;
      x2 = Math.min(Math.max(dockLeft + cornerInset, sentenceCenterX), dockRight - cornerInset);
      y2 = dockTop;

      y1 = sentenceRect.bottom + 2;
      x1 = Math.min(Math.max(sentenceRect.left + 10, x2), sentenceRect.right - 10);
    } else {
      // Dock is to the left or right of the text
      orientation = "side";
      const dockIsRight = dockLeft >= sentenceRect.left;
      if (dockIsRight) {
        x1 = lastRect.right + 3;
        y1 = lastRect.top + lastRect.height / 2;
        x2 = dockLeft;
      } else {
        x1 = firstRect.left - 3;
        y1 = firstRect.top + firstRect.height / 2;
        x2 = dockRight;
      }

      if (minimized) {
        y2 = dockTop + (dockBottom - dockTop) / 2;
      } else if (y1 >= dockTop && y1 <= dockBottom) {
        y2 = Math.min(Math.max(dockTop + 24, y1), dockTop + 140);
      } else if (y1 < dockTop) {
        y2 = dockTop + 28;
      } else {
        y2 = Math.min(dockBottom - 20, dockTop + 140);
      }
    }

    setCoords({ x1, y1, x2, y2, orientation });
  }, [cardRef, position, minimized, targetText]);

  useEffect(() => {
    updateLine();
    const handleScrollOrResize = () => updateLine();
    window.addEventListener("scroll", handleScrollOrResize, { capture: true, passive: true });
    window.addEventListener("resize", handleScrollOrResize, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [updateLine]);

  useEffect(() => {
    updateLine();
  }, [position, isDragging, updateLine]);

  if (!coords) return null;

  const { x1, y1, x2, y2, orientation } = coords;
  let pathData = "";

  if (orientation === "bottom") {
    // Dock is on top of the text -> line leaves sentence going UP and enters dock at the BOTTOM
    const dy = Math.max(10, y1 - y2);
    const curvature = Math.max(25, Math.min(dy * 0.45, 140));
    const cp1x = x1;
    const cp1y = y1 - curvature;
    const cp2x = x2;
    const cp2y = y2 + curvature;
    pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
  } else if (orientation === "top") {
    // Dock is below the text -> line leaves sentence going DOWN and enters dock at the TOP
    const dy = Math.max(10, y2 - y1);
    const curvature = Math.max(25, Math.min(dy * 0.45, 140));
    const cp1x = x1;
    const cp1y = y1 + curvature;
    const cp2x = x2;
    const cp2y = y2 - curvature;
    pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
  } else {
    // Dock is to the left or right of the text -> horizontal S-curve
    const dx = x2 - x1;
    const isRight = dx >= 0;
    const absDx = Math.abs(dx);
    const curvature = Math.max(35, Math.min(absDx * 0.5, 180));
    const cp1x = isRight ? x1 + curvature : x1 - curvature;
    const cp1y = y1;
    const cp2x = isRight ? x2 - curvature : x2 + curvature;
    const cp2y = y2;
    pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
  }

  return (
    <svg
      className="fixed inset-0 pointer-events-none z-40 w-full h-full overflow-visible"
      aria-hidden="true"
    >
      {/* Single clean cropped / dashed curve connecting sentence with dock */}
      <path
        d={pathData}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeDasharray="6 4"
        strokeLinecap="round"
        className="text-primary"
      />

      {/* Sentence anchor terminal pin (start dot) */}
      <circle
        cx={x1}
        cy={y1}
        r={3.5}
        fill="var(--primary)"
      />

      {/* Dock anchor terminal pin (end dot) */}
      <circle
        cx={x2}
        cy={y2}
        r={3.5}
        fill="var(--primary)"
      />
    </svg>
  );
}

export function CitationReviewDock({
  state,
  onClose,
  onApprove,
  onReject,
  onSkipClaim,
  onNavigateClaim,
}: {
  state: CitationApprovalState | null;
  onClose: () => void;
  onApprove: (
    match: CitationFindMatch,
    range: { from: number; to: number },
    draftFilePath: string,
    options?: {
      selectedMatches?: CitationFindMatch[];
      overrideParagraphDuplicate?: boolean;
    },
  ) => void;
  onReject: () => void;
  onSkipClaim?: () => void;
  onNavigateClaim?: (index: number) => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedMatchKeys, setSelectedMatchKeys] = useState<Set<string>>(new Set());
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Advance real-time scanning steps while search is in progress
  useEffect(() => {
    if (state?.status !== "searching") {
      setCurrentStepIndex(0);
      return;
    }

    setCurrentStepIndex(0);
    const timers: NodeJS.Timeout[] = [];
    let accumulatedTime = 0;

    for (let i = 0; i < SCANNING_STEPS.length - 1; i++) {
      accumulatedTime += SCANNING_STEPS[i].durationMs;
      const nextIndex = i + 1;
      const t = setTimeout(() => {
        setCurrentStepIndex(nextIndex);
      }, accumulatedTime);
      timers.push(t);
    }

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [state?.status, state?.text]);
  const cardRef = useRef<HTMLElement | null>(null);
  const dragStartRef = useRef<{
    startPointerX: number;
    startPointerY: number;
    startElemX: number;
    startElemY: number;
  } | null>(null);

  // Restore saved position on mount (client-only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("beeblio_citation_dock_position");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
          setPosition(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist position whenever it changes
  useEffect(() => {
    try {
      if (position) {
        localStorage.setItem("beeblio_citation_dock_position", JSON.stringify(position));
      } else {
        localStorage.removeItem("beeblio_citation_dock_position");
      }
    } catch {
      // ignore
    }
  }, [position]);

  // Keep dock inside screen viewport on resize or expand/collapse
  useEffect(() => {
    if (!position) return;

    const clampToViewport = () => {
      const node = cardRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const minX = 8;
      const maxX = Math.max(minX, window.innerWidth - rect.width - 8);
      const minY = 8;
      const maxY = Math.max(minY, window.innerHeight - rect.height - 8);

      setPosition((prev) => {
        if (!prev) return null;
        const nextX = Math.round(Math.min(Math.max(prev.x, minX), maxX));
        const nextY = Math.round(Math.min(Math.max(prev.y, minY), maxY));
        if (nextX === prev.x && nextY === prev.y) return prev;
        return { x: nextX, y: nextY };
      });
    };

    const rafId = requestAnimationFrame(clampToViewport);
    window.addEventListener("resize", clampToViewport);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", clampToViewport);
    };
  }, [minimized]);

  // Global safety listener for pointer up
  useEffect(() => {
    if (!isDragging) return;
    const handleGlobalPointerUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [isDragging]);

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea, [role='button']")) {
      return;
    }
    const node = cardRef.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    dragStartRef.current = {
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startElemX: rect.left,
      startElemY: rect.top,
    };
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragStartRef.current || !cardRef.current) return;
    const deltaX = e.clientX - dragStartRef.current.startPointerX;
    const deltaY = e.clientY - dragStartRef.current.startPointerY;

    const rect = cardRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const rawX = dragStartRef.current.startElemX + deltaX;
    const rawY = dragStartRef.current.startElemY + deltaY;

    const minX = 8;
    const maxX = Math.max(minX, window.innerWidth - width - 8);
    const minY = 8;
    const maxY = Math.max(minY, window.innerHeight - height - 8);

    const clampedX = Math.min(Math.max(rawX, minX), maxX);
    const clampedY = Math.min(Math.max(rawY, minY), maxY);

    setPosition({ x: Math.round(clampedX), y: Math.round(clampedY) });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (dragStartRef.current) {
      dragStartRef.current = null;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    setSelectedIndex(0);
    setSelectedMatchKeys(new Set());
  }, [state?.text]);

  if (!state || !state.isOpen) return null;

  const { status, text, error, range, draftFilePath } = state;
  const matches: CitationFindMatch[] =
    state.matches && state.matches.length > 0
      ? state.matches
      : state.match
        ? [state.match]
        : [];
  const activeMatch = matches[selectedIndex] ?? matches[0] ?? state.match;

  const effectiveSelectedMatches = matches.filter((m) =>
    selectedMatchKeys.has(m.citationKey),
  );
  const activeKeys =
    effectiveSelectedMatches.length > 0
      ? effectiveSelectedMatches.map((m) => m.citationKey)
      : activeMatch
        ? [activeMatch.citationKey]
        : [];

  const placement = calculateCitationPlacement(
    state.paragraphText || state.text,
    state.text,
    undefined,
    activeKeys,
  );

  const activeHygiene = activeMatch
    ? checkParagraphCitationHygiene(
        state.paragraphText || state.text,
        activeMatch.citationKey,
        state.existingCitationKeys,
        state.text,
      )
    : null;

  const handleOpenSourceForMatch = (m: CitationFindMatch) => {
    if (!m.sourceFilePath) return;
    window.dispatchEvent(
      new CustomEvent(OPEN_WORKSPACE_FILE_EVENT, {
        detail: {
          path: m.sourceFilePath,
          name: m.sourceFileName || m.sourceFilePath.split("/").pop() || "source",
        },
      }),
    );
  };

  const handleBackToDraft = () => {
    if (!draftFilePath) return;
    window.dispatchEvent(
      new CustomEvent(OPEN_WORKSPACE_FILE_EVENT, {
        detail: {
          path: draftFilePath,
          name: draftFilePath.split("/").pop() || "draft",
        },
      }),
    );
  };

  // Minimized Pill view (Draggable)
  if (minimized) {
    const isAudit = Boolean(state.auditQueue);
    const isCompleted = Boolean(state.auditQueue?.completed);
    return (
      <>
        <CitationConnectorLine
          cardRef={cardRef}
          position={position}
          isDragging={isDragging}
          targetText={state.text}
          minimized={true}
        />
        <aside
        ref={cardRef}
        aria-label="Citation review dock"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, a, [role='button']")) {
            setPosition(null);
          }
        }}
        style={
          position
            ? {
                left: `${position.x}px`,
                top: `${position.y}px`,
                right: "auto",
                bottom: "auto",
              }
            : undefined
        }
        className={cn(
          "fixed z-50 flex items-center gap-2 rounded-full border border-primary/30 bg-background/95 px-3 py-1.5 shadow-xl backdrop-blur-md cursor-grab active:cursor-grabbing select-none touch-none",
          !position && "bottom-4 right-4",
          isDragging ? "transition-none ring-2 ring-primary/40 shadow-2xl scale-[1.02]" : "transition-all duration-200",
        )}
        title="Drag anywhere to reposition · Double-click to reset"
      >
        <GripHorizontal className="size-3.5 text-muted-foreground/60 shrink-0 pointer-events-none" />
        {isAudit ? (
          <ShieldCheck className="size-3.5 text-emerald-500 animate-pulse shrink-0 pointer-events-none" />
        ) : (
          <Sparkles className="size-3.5 text-primary animate-pulse shrink-0 pointer-events-none" />
        )}
        <span className="text-xs font-semibold text-foreground pointer-events-none select-none truncate max-w-[280px]">
          {isCompleted
            ? `Review Complete (${state.auditQueue?.approvedCount ?? 0} cited)`
            : isAudit
              ? status === "searching"
                ? `Auto-Cite (${(state.auditQueue?.currentIndex ?? 0) + 1}/${state.auditQueue?.claims.length}) · ${SCANNING_STEPS[currentStepIndex]?.short}`
                : `Auto-Cite (${(state.auditQueue?.currentIndex ?? 0) + 1}/${state.auditQueue?.claims.length})`
              : status === "searching"
                ? (SCANNING_STEPS[currentStepIndex]?.short || "Searching citations…")
                : status === "already_cited"
                  ? `Already cited in paragraph (@${state.alreadyCitedKey || activeMatch?.citationKey})`
                  : status === "found" && activeMatch
                    ? `${matches.length > 1 ? `${matches.length} matches · ` : ""}Top: @${activeMatch.citationKey} (${activeMatch.score}%)`
                    : status === "not_found"
                      ? "No citations found"
                      : "Citation search error"}
        </span>
        {status === "found" && activeMatch?.sourceFilePath && !isCompleted ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => handleOpenSourceForMatch(activeMatch)}
            className="h-6 gap-1 px-1.5 text-[11px] text-primary hover:text-primary pointer-events-auto"
            title="Check source file"
          >
            Check source <ExternalLink className="size-3" />
          </Button>
        ) : null}
        {position && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => setPosition(null)}
            className="size-6 text-muted-foreground hover:text-foreground pointer-events-auto"
            title="Reset position to bottom-right"
          >
            <RotateCcw className="size-3" />
          </Button>
        )}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setMinimized(false)}
          className="size-6 text-muted-foreground hover:text-foreground pointer-events-auto"
          title="Expand citation review"
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          className="size-6 text-muted-foreground hover:text-foreground pointer-events-auto"
          title="Dismiss"
        >
          <X className="size-3.5" />
        </Button>
      </aside>
    </>
  );
  }

  const isAudit = Boolean(state.auditQueue);
  const auditQueue = state.auditQueue;
  const currentClaim = auditQueue ? auditQueue.claims[auditQueue.currentIndex] : null;
  const isCompleted = Boolean(auditQueue?.completed);

  // Expanded Non-Modal Floating Card (Draggable by Header)
  return (
    <>
      <CitationConnectorLine
        cardRef={cardRef}
        position={position}
        isDragging={isDragging}
        targetText={state.text}
        minimized={false}
      />
      <aside
      ref={cardRef}
      aria-label="Citation review dock"
      style={
        position
          ? {
              left: `${position.x}px`,
              top: `${position.y}px`,
              right: "auto",
              bottom: "auto",
            }
          : undefined
      }
      className={cn(
        "fixed z-50 flex w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border/80 bg-background/95 shadow-2xl backdrop-blur-md",
        !position && "bottom-4 right-4",
        isDragging ? "transition-none ring-2 ring-primary/40 shadow-2xl" : "transition-all duration-200",
      )}
    >
      {/* Header (Draggable Handle) */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, a, [role='button']")) {
            setPosition(null);
          }
        }}
        className="flex items-center justify-between border-b bg-muted/40 px-3.5 py-2.5 cursor-grab active:cursor-grabbing select-none touch-none"
        title="Drag anywhere to reposition · Double-click to reset"
      >
        <div className="flex items-center gap-2 min-w-0 pointer-events-none">
          <GripHorizontal className="size-3.5 text-muted-foreground/60 shrink-0" />
          <div className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            isAudit ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-primary/15 text-primary"
          )}>
            {isAudit ? <ShieldCheck className="size-3.5" /> : <Sparkles className="size-3.5" />}
          </div>
          <span className="truncate text-xs font-semibold text-foreground">
            {isCompleted
              ? "All Claims Reviewed"
              : isAudit && auditQueue
                ? status === "searching"
                  ? `Auto-Cite · Claim ${auditQueue.currentIndex + 1}/${auditQueue.claims.length} (${SCANNING_STEPS[currentStepIndex]?.short})`
                  : `Auto-Cite · Claim ${auditQueue.currentIndex + 1} of ${auditQueue.claims.length}`
                : status === "searching"
                  ? (SCANNING_STEPS[currentStepIndex]?.title || "Searching Bibliography Knowledge Base")
                  : status === "found"
                    ? matches.length > 1
                      ? `Choose Citation (${matches.length} Scored Matches)`
                      : "Citation Review & Verification"
                    : status === "not_found"
                      ? "Citation Search"
                      : "Citation Search Error"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 pointer-events-auto">
          {isAudit && !isCompleted && auditQueue && (
            <>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={auditQueue.currentIndex === 0}
                onClick={() => onNavigateClaim?.(auditQueue.currentIndex - 1)}
                className="size-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
                title="Previous claim"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={auditQueue.currentIndex === auditQueue.claims.length - 1}
                onClick={() => onNavigateClaim?.(auditQueue.currentIndex + 1)}
                className="size-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
                title="Next claim"
              >
                <ChevronRight className="size-3.5" />
              </Button>
              <div className="h-3.5 w-px bg-border/60 mx-0.5" />
            </>
          )}
          {position && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => setPosition(null)}
              className="size-6 text-muted-foreground hover:text-foreground"
              title="Reset position to bottom-right"
            >
              <RotateCcw className="size-3" />
            </Button>
          )}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => setMinimized(true)}
            className="size-6 text-muted-foreground hover:text-foreground"
            title="Minimize to floating pill"
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            className="size-6 text-muted-foreground hover:text-foreground"
            title="Close"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Audit Progress & Queue Bar */}
      {isAudit && !isCompleted && auditQueue && (
        <div className="border-b bg-muted/20 px-3.5 py-1.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span className="font-semibold text-foreground">
                Claim {auditQueue.currentIndex + 1}/{auditQueue.claims.length}
              </span>
              {currentClaim?.signal && (
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 px-1.5 py-0 truncate max-w-[200px]">
                  {currentClaim.signal}
                </Badge>
              )}
              {status === "already_cited" && (
                <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0">
                  Already supported in paragraph
                </Badge>
              )}
              {currentClaim?.requiresMultipleSources && (
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0">
                  Multiple sources needed
                </Badge>
              )}
            </div>
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
              {auditQueue.approvedCount} cited · {auditQueue.skippedCount} skipped
            </span>
          </div>
          {currentClaim?.q1Guideline && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 dark:bg-amber-500/15 px-2.5 py-1 text-[11px] text-amber-800 dark:text-amber-300">
              <ShieldCheck className="size-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span className="leading-tight font-medium">
                {currentClaim.q1Guideline}
              </span>
            </div>
          )}
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{
                width: `${Math.round(((auditQueue.currentIndex + 1) / auditQueue.claims.length) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="max-h-[min(68vh,520px)] overflow-y-auto p-3.5 space-y-3">
        {isCompleted && auditQueue ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center p-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-8" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-foreground">All Claims Reviewed!</h4>
              <p className="text-xs text-muted-foreground max-w-xs">
                All {auditQueue.claims.length} empirical claims in this document have been reviewed against your bibliography.
              </p>
            </div>
            <div className="flex items-center gap-6 rounded-lg border bg-muted/30 px-5 py-3 text-xs mt-1">
              <div className="text-center">
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{auditQueue.approvedCount}</p>
                <p className="text-[11px] text-muted-foreground">Citations Added</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="text-center">
                <p className="text-lg font-bold text-muted-foreground">{auditQueue.skippedCount}</p>
                <p className="text-[11px] text-muted-foreground">Claims Skipped</p>
              </div>
            </div>
          </div>
        ) : null}
        {status === "searching" && (
          <div className="py-1 space-y-3">
            {/* Active Stage Callout Card */}
            <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Spinner className="size-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {SCANNING_STEPS[currentStepIndex]?.title}
                  </p>
                  <span className="text-[10px] font-mono font-medium text-primary shrink-0">
                    Step {currentStepIndex + 1} of {SCANNING_STEPS.length}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {SCANNING_STEPS[currentStepIndex]?.detail}
                </p>
              </div>
            </div>

            {/* Smooth Animated Progress Bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-500 ease-out"
                style={{
                  width: `${Math.min(95, Math.round(((currentStepIndex + 1) / SCANNING_STEPS.length) * 100))}%`,
                }}
              />
            </div>

            {/* Live Real-time Steps Checklist */}
            <div className="space-y-1 rounded-lg border bg-muted/20 p-2">
              <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50 mb-1">
                <span>Real-time Scanning Steps</span>
                <span>Status</span>
              </div>
              {SCANNING_STEPS.map((step, idx) => {
                const isDone = idx < currentStepIndex;
                const isCurrent = idx === currentStepIndex;
                const isUpcoming = idx > currentStepIndex;

                return (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center justify-between gap-2.5 rounded-md px-2.5 py-1.5 transition-all text-left",
                      isCurrent && "bg-background border border-primary/25 shadow-2xs",
                      isDone && "opacity-90",
                      isUpcoming && "opacity-40",
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="shrink-0 flex items-center justify-center">
                        {isDone ? (
                          <CheckCircle2 className="size-3.5 text-emerald-500 animate-in zoom-in-50 duration-200" />
                        ) : isCurrent ? (
                          <Spinner className="size-3.5 text-primary" />
                        ) : (
                          <Circle className="size-3.5 text-muted-foreground/30" />
                        )}
                      </div>
                      <span className={cn(
                        "text-xs truncate",
                        isCurrent ? "font-semibold text-foreground" : isDone ? "font-medium text-foreground/80" : "text-muted-foreground",
                      )}>
                        {step.title}
                      </span>
                    </div>

                    <span className={cn(
                      "text-[10px] font-mono shrink-0",
                      isDone && "text-emerald-600 dark:text-emerald-400 font-semibold",
                      isCurrent && "text-primary font-semibold animate-pulse",
                      isUpcoming && "text-muted-foreground/60",
                    )}>
                      {isDone ? "Done" : isCurrent ? "Scanning…" : "Waiting"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Target passage from draft */}
            <div className="w-full rounded-md border bg-muted/30 p-2.5 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                Target passage in draft:
              </p>
              <p className="line-clamp-2 text-xs italic text-foreground/85 leading-relaxed">
                "{text}"
              </p>
            </div>
          </div>
        )}

        {status === "found" && matches.length > 0 && (
          <div className="space-y-3">
            {/* Written passage in document */}
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <FileText className="size-3" />
                <span>Your written text in document:</span>
              </div>
              <div className="text-xs italic leading-relaxed text-foreground/90">
                "{text}"
              </div>
            </div>

            {/* Candidate Matches Header */}
            <div className="flex items-center justify-between text-xs font-semibold text-foreground pt-0.5">
              <span>Candidate Matches ({matches.length})</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                Select one to inspect &amp; cite
              </span>
            </div>

            {/* List of Scored Candidates */}
            <div className="space-y-2">
              {matches.map((m, idx) => {
                const isSelected = idx === selectedIndex;
                const rec = m.recommendation || (m.score >= 80 ? "RECOMMEND" : m.score >= 60 ? "PARTIAL_SUPPORT" : "NEEDS_REVIEW");
                const verificationLabel = m.verificationLabel;

                return (
                  <div
                    key={`${m.citationKey}:${m.sourceLocation}:${idx}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedIndex(idx)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSelectedIndex(idx);
                    }}
                    className={cn(
                      "rounded-lg border p-3 transition-all cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30 shadow-xs"
                        : "border-border/80 bg-card/60 hover:bg-muted/40 hover:border-primary/40",
                    )}
                  >
                    {/* Top Row: Multi-select Checkbox, Recommendation Badge, Citation Key, Location & Check Source Button */}
                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        {matches.length > 1 && (
                          <input
                            type="checkbox"
                            checked={selectedMatchKeys.has(m.citationKey)}
                            onChange={(e) => {
                              e.stopPropagation();
                              setSelectedMatchKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(m.citationKey)) {
                                  next.delete(m.citationKey);
                                } else {
                                  next.add(m.citationKey);
                                }
                                return next;
                              });
                            }}
                            className="size-3.5 rounded border-muted-foreground/40 accent-primary cursor-pointer shrink-0"
                            title="Select to bundle this citation into co-citation group"
                          />
                        )}

                        {rec === "RECOMMEND" && (
                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 font-semibold text-[10px] gap-1 px-1.5 py-0.5">
                            <CheckCircle2 className="size-3" /> RECOMMEND
                          </Badge>
                        )}
                        {rec === "PARTIAL_SUPPORT" && (
                          <Badge className="bg-amber-600 text-white hover:bg-amber-600 font-semibold text-[10px] gap-1 px-1.5 py-0.5">
                            <AlertTriangle className="size-3" /> PARTIAL SUPPORT
                          </Badge>
                        )}
                        {rec === "NEEDS_REVIEW" && (
                          <Badge className="bg-purple-600 text-white hover:bg-purple-600 font-semibold text-[10px] gap-1 px-1.5 py-0.5">
                            <FileSearch className="size-3" /> NEEDS REVIEW
                          </Badge>
                        )}
                        {rec === "REJECT" && (
                          <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive font-semibold text-[10px] gap-1 px-1.5 py-0.5">
                            <X className="size-3" /> REJECT
                          </Badge>
                        )}

                        <Badge variant="outline" className="border-primary/40 px-1.5 py-0 text-[10px] font-mono text-primary font-semibold">
                          @{m.citationKey}
                        </Badge>
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {m.sourceLocation}
                        </Badge>

                        {(() => {
                          const itemHygiene = checkParagraphCitationHygiene(
                            state.paragraphText || state.text,
                            m.citationKey,
                            state.existingCitationKeys,
                            state.text,
                          );
                          return itemHygiene.isDuplicated ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10 px-1.5 py-0 text-[10px]"
                            >
                              Already in Paragraph
                            </Badge>
                          ) : null;
                        })()}

                        {m.isSecondaryCitation && (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-600 bg-amber-500/10 px-1.5 py-0 text-[10px]">
                            Secondary Source
                          </Badge>
                        )}

                        {/* Distinct Relevance vs Entailment Display */}
                        {m.retrievalScore !== undefined && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            Relevance: {m.retrievalScore}%
                          </span>
                        )}
                      </div>

                      {m.sourceFilePath ? (
                        <Button
                          type="button"
                          size="xs"
                          variant={isSelected ? "default" : "outline"}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenSourceForMatch(m);
                          }}
                          className={cn(
                            "h-6 shrink-0 gap-1 px-2 text-[11px] shadow-2xs",
                            isSelected
                              ? "bg-primary text-primary-foreground hover:bg-primary/90"
                              : "text-foreground hover:text-primary",
                          )}
                          title="Open source file in workspace to inspect"
                        >
                          <FileSearch className="size-3" />
                          Check Source
                        </Button>
                      ) : null}
                    </div>

                    {/* Reference Title & Authors */}
                    <div className="mt-1.5 min-w-0">
                      <p className="font-semibold text-xs text-foreground truncate">
                        {m.reference.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {m.reference.authors} {m.reference.year ? `(${m.reference.year})` : ""}
                      </p>
                    </div>

                    {/* Evidence Verification Label if available */}
                    {verificationLabel && (
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-medium text-muted-foreground">Evidence Status:</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0 font-medium",
                            verificationLabel === "SUPPORTED" && "border-emerald-500/40 text-emerald-600 bg-emerald-500/10",
                            verificationLabel === "PARTIALLY_SUPPORTED" && "border-amber-500/40 text-amber-600 bg-amber-500/10",
                            verificationLabel === "RELATED_BUT_UNSUPPORTED" && "border-orange-500/40 text-orange-600 bg-orange-500/10",
                            verificationLabel === "CONTRADICTED" && "border-red-500/40 text-red-600 bg-red-500/10",
                            verificationLabel === "INSUFFICIENT_CONTEXT" && "border-zinc-500/40 text-zinc-600 bg-zinc-500/10",
                          )}
                        >
                          {verificationLabel.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    )}

                    {/* Details if Selected vs Snippet if Unselected */}
                    {isSelected ? (
                      <div className="mt-2.5 pt-2 border-t border-primary/15 space-y-2">
                        <div className="rounded-md border border-primary/20 bg-background/85 p-2 text-xs">
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-primary mb-1">
                            <Quote className="size-3" />
                            <span>Evidence excerpt in source ({m.sourceLocation}):</span>
                          </div>
                          <p className="italic leading-relaxed text-foreground/95">
                            "{m.evidenceExcerpt || m.originalText}"
                          </p>
                        </div>

                        {/* Subclaims breakdown if available */}
                        {m.supportedSubclaims && m.supportedSubclaims.length > 0 && (
                          <div className="space-y-0.5 rounded-md bg-emerald-500/5 border border-emerald-500/20 p-2 text-xs">
                            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                              ✓ Supported Subclaims:
                            </span>
                            {m.supportedSubclaims.map((sub, sIdx) => (
                              <p key={sIdx} className="text-[11px] text-foreground/90 pl-2">
                                • {sub}
                              </p>
                            ))}
                          </div>
                        )}

                        {m.unsupportedSubclaims && m.unsupportedSubclaims.length > 0 && (
                          <div className="space-y-0.5 rounded-md bg-amber-500/5 border border-amber-500/20 p-2 text-xs">
                            <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                              ⚠ Unsupported Subclaims (Needs additional source):
                            </span>
                            {m.unsupportedSubclaims.map((sub, sIdx) => (
                              <p key={sIdx} className="text-[11px] text-amber-900/90 dark:text-amber-200/90 pl-2">
                                • {sub}
                              </p>
                            ))}
                          </div>
                        )}

                        {m.contradictedSubclaims && m.contradictedSubclaims.length > 0 && (
                          <div className="space-y-0.5 rounded-md bg-red-500/10 border border-red-500/30 p-2 text-xs">
                            <span className="text-[10px] font-semibold text-destructive">
                              ✕ Contradicted Claims:
                            </span>
                            {m.contradictedSubclaims.map((sub, sIdx) => (
                              <p key={sIdx} className="text-[11px] text-destructive pl-2">
                                • {sub}
                              </p>
                            ))}
                          </div>
                        )}

                        {m.discrepancies && m.discrepancies.length > 0 && (
                          <div className="space-y-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-xs">
                            <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                              Discrepancy Flags:
                            </span>
                            {m.discrepancies.map((disc, dIdx) => (
                              <p key={dIdx} className="text-[11px] text-amber-900 dark:text-amber-200 pl-2">
                                ⚠ {disc}
                              </p>
                            ))}
                          </div>
                        )}

                        <p className="text-[11px] text-muted-foreground leading-normal">
                          <span className="font-medium text-foreground">Recommendation rationale:</span>{" "}
                          {m.reasoning || m.explanation}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] italic text-muted-foreground line-clamp-1">
                        "{m.evidenceExcerpt || m.originalText}"
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Academic In-Text Placement Preview */}
            <div className="rounded-md border border-border/80 bg-muted/30 p-2.5 text-xs space-y-1 mt-2">
              <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Quote className="size-3 text-primary" /> In-Text Citation Placement Preview:
                </span>
                <span className="font-mono text-primary text-[10px]">
                  {placement.context.replace(/_/g, " ")}
                </span>
              </div>
              <p className="font-mono text-[11px] leading-relaxed text-foreground/90 break-words bg-background/80 p-2 rounded border border-border/50">
                {placement.preview}
              </p>
            </div>

            {activeHygiene?.isDuplicated && !activeHygiene.isExemptStatistic && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200 mt-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div className="space-y-0.5">
                  <p className="font-semibold">Redundant Paragraph Citation</p>
                  <p className="text-[11px] opacity-90">
                    @{activeMatch.citationKey} is already cited in this paragraph. Citing the same work multiple times within a single paragraph is discouraged in journal publications unless distinguishing separate quantitative statistics.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {status === "already_cited" && (
          <div className="space-y-2.5 py-2">
            <div className="flex items-start gap-2.5 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-900 dark:text-blue-100">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="font-semibold">
                  Already supported by @{state.alreadyCitedKey || activeMatch?.citationKey} in this paragraph
                </p>
                <p className="mt-1 text-blue-900/80 dark:text-blue-200/80 leading-relaxed text-[11px]">
                  Under citation best practices, use one citation at the end of a paragraph when all claims in that paragraph are supported by the same source and attribution is unambiguous. No duplicate citation needed.
                </p>
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                Covered assertion:
              </p>
              <p className="italic text-foreground/80 line-clamp-2">"{text}"</p>
            </div>
          </div>
        )}

        {status === "not_found" && (
          <div className="space-y-2.5 py-2">
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold">No supporting citations found</p>
                <p className="mt-0.5 text-amber-900/80 dark:text-amber-300/80">
                  {error || "None of the references or files in your bibliography knowledge base match this passage."}
                </p>
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                Checked passage:
              </p>
              <p className="italic text-foreground/80 line-clamp-2">"{text}"</p>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Search failed</p>
              <p className="mt-0.5">{error || "Could not complete citation search."}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-3.5 py-2.5 overflow-hidden">
        {isCompleted ? (
          <div className="ml-auto">
            <Button type="button" size="xs" onClick={onClose} className="h-7 px-4 text-[11px]">
              Finish
            </Button>
          </div>
        ) : status === "found" && activeMatch ? (
          <>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={handleBackToDraft}
                className="h-7 text-[11px]"
                title="Focus the draft document tab"
              >
                Back to draft
              </Button>
              {isAudit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={onSkipClaim}
                  className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
                  title="Skip this claim without citing"
                >
                  Skip Claim
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={onReject}
                  className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
                  title="Reject this candidate citation"
                >
                  Reject Citation
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink min-w-0">
              {/* If recommendation requires review or is partial, offer direct evidence inspection */}
              {(activeMatch.recommendation === "PARTIAL_SUPPORT" ||
                activeMatch.recommendation === "NEEDS_REVIEW") &&
                activeMatch.sourceFilePath && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => handleOpenSourceForMatch(activeMatch)}
                    className="h-7 gap-1 px-2.5 text-[11px] text-purple-600 dark:text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                    title="Open full source passage and context in workspace"
                  >
                    <FileSearch className="size-3" />
                    Review Evidence
                  </Button>
                )}

              {activeMatch.recommendation === "REJECT" ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="h-7 gap-1 px-3 text-[11px] text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={onReject}
                  title="Reject citation as evidence does not substantiate claim"
                >
                  <X className="size-3 shrink-0" />
                  <span>Reject Citation</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="xs"
                  className={cn(
                    "h-7 gap-1 px-3 text-[11px] shrink min-w-0 max-w-[280px] overflow-hidden",
                    activeMatch.recommendation === "RECOMMEND"
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                      : "bg-primary text-primary-foreground",
                  )}
                  onClick={() =>
                    onApprove(activeMatch, range, draftFilePath, {
                      selectedMatches:
                        effectiveSelectedMatches.length > 1
                          ? effectiveSelectedMatches
                          : undefined,
                      overrideParagraphDuplicate: Boolean(
                        activeHygiene?.isDuplicated,
                      ),
                    })
                  }
                  title={`Approve & Cite (@${activeKeys.join("; @")})`}
                >
                  <Check className="size-3 shrink-0" />
                  <span className="shrink-0 font-medium">
                    {effectiveSelectedMatches.length > 1
                      ? `Approve & Bundle (${effectiveSelectedMatches.length})`
                      : activeHygiene?.isDuplicated
                        ? "Approve & Cite Anyway"
                        : "Approve & Cite"}
                  </span>
                  <span className="truncate font-mono text-[10px] opacity-80">
                    (@{activeKeys.join("; @")})
                  </span>
                </Button>
              )}
            </div>
          </>
        ) : status === "already_cited" ? (
          <>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={handleBackToDraft}
                className="h-7 text-[11px]"
                title="Focus the draft document tab"
              >
                Back to draft
              </Button>
              {activeMatch && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onApprove(activeMatch, range, draftFilePath)}
                  className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
                  title="Cite anyway even though already cited in this paragraph"
                >
                  Cite anyway
                </Button>
              )}
            </div>
            {isAudit ? (
              <Button
                type="button"
                size="xs"
                className="h-7 gap-1 px-3 text-[11px] bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                onClick={onSkipClaim}
                title="Next Claim (Already supported in this paragraph)"
              >
                <span>Next claim</span>
                <SkipForward className="size-3" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={onClose}
                className="h-7 text-[11px]"
              >
                Close
              </Button>
            )}
          </>
        ) : isAudit ? (
          <div className="flex items-center justify-between w-full">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onSkipClaim}
              className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
            >
              Skip to next claim <SkipForward className="size-3" />
            </Button>
            <Button type="button" variant="outline" size="xs" onClick={onClose} className="h-7 text-[11px]">
              Close Assistant
            </Button>
          </div>
        ) : (
          <div className="ml-auto">
            <Button type="button" variant="outline" size="xs" onClick={onClose} className="h-7 text-[11px]">
              Close
            </Button>
          </div>
        )}
      </div>
    </aside>
  </>
);
}
