"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookCheck, Check, CheckCheck, Circle, FileSearch, FileUp, Loader2, MessageSquareQuote,
  PenLine, ShieldCheck, X, GraduationCap, FlaskConical, Leaf, Info, OctagonAlert, TriangleAlert, ChevronLeft, ChevronDown, ChevronUp, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  FIND_CITATION_REQUEST_EVENT,
  APPLY_CITATION_EVENT,
  type FindCitationRequestDetail,
  type ApplyCitationDetail,
} from "@/lib/chat-context";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_REVIEW_DOCUMENT_CHARACTERS } from "@/lib/document-review-chunks";
import {
  DOCUMENT_REVIEW_ACCEPTED_EVENT,
  DOCUMENT_REVIEW_ANCHOR_EVENT,
  DOCUMENT_REVIEW_PROPOSAL_EVENT,
  DOCUMENT_REVIEW_REJECTED_EVENT,
  applyReviewFindings,
  type DocumentReviewAcceptedDetail,
  type DocumentReviewAnchorDetail,
  type DocumentReviewProposalDetail,
  type DocumentReviewRejectedDetail,
  type DocumentReviewResult,
  type ReviewFinding,
  type ReviewType,
} from "@/lib/document-review";
import { reviewDocument } from "../document-review-actions";

const OPTIONS: { id: ReviewType; title: string; description: string; icon: typeof ShieldCheck }[] = [
  { id: "proofread", title: "Proofread", description: "Fix grammar, punctuation, and wording.", icon: CheckCheck },
  { id: "tone", title: "Tone & Style", description: "Match a scholarly writing style.", icon: PenLine },
  { id: "source-quality", title: "Source Audit", description: "Audit citations and source-quality signals.", icon: BookCheck },
  { id: "claim-confidence", title: "Claim Expression", description: "Find unsupported claims and citation risks.", icon: ShieldCheck },
  { id: "peer-review", title: "Simulate Peer Review", description: "Get an expert-style academic review.", icon: MessageSquareQuote },
];

const PROGRESS_STEPS: Record<ReviewType, string[]> = {
  "claim-confidence": ["Mapping claims", "Checking citation coverage", "Assessing support", "Preparing findings"],
  "peer-review": ["Reading structure and contribution", "Assessing methods and validity", "Testing arguments and limitations", "Writing reviewer report"],
  "source-quality": ["Resolving citation keys", "Checking source metadata", "Assessing source fit", "Preparing quality report"],
  tone: ["Profiling current voice", "Comparing target style", "Checking meaning and citations", "Preparing revisions"],
  proofread: ["Scanning grammar and punctuation", "Checking wording and consistency", "Protecting Markdown and citations", "Preparing corrections"],
};

export function DocumentReviewPanel({ projectId, filePath, content }: {
  projectId: string;
  filePath?: string;
  content: string | null;
}) {
  const [selected, setSelected] = useState<ReviewType>();
  const [tonePreset, setTonePreset] = useState<"formal-academic" | "concise-scientific" | "clear-natural">("formal-academic");
  const [styleReference, setStyleReference] = useState("");
  const [styleReferenceName, setStyleReferenceName] = useState<string>();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DocumentReviewResult>();
  const [reviewedContent, setReviewedContent] = useState<string>();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [progressStep, setProgressStep] = useState(0);
  const [toneSettingsOpen, setToneSettingsOpen] = useState(true);

  useEffect(() => {
    if (!running) return;
    setProgressStep(0);
    const timer = window.setInterval(() => setProgressStep((step) => Math.min(step + 1, 3)), 2_800);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const accepted = (event: Event) => {
      const detail = (event as CustomEvent<DocumentReviewAcceptedDetail>).detail;
      if (detail?.filePath !== filePath) return;
      if (detail.mode === "commit") {
        setResult(undefined);
        setReviewedContent(undefined);
        setReviewed(new Set());
        setDismissed(new Set());
        return;
      }
      setReviewed((current) => new Set([...current, ...detail.findingIds]));
    };
    window.addEventListener(DOCUMENT_REVIEW_ACCEPTED_EVENT, accepted);
    return () => window.removeEventListener(DOCUMENT_REVIEW_ACCEPTED_EVENT, accepted);
  }, [filePath]);

  useEffect(() => {
    const rejected = (event: Event) => {
      const detail = (event as CustomEvent<DocumentReviewRejectedDetail>).detail;
      if (detail?.filePath !== filePath || detail.mode !== "stage") return;
      setDismissed((current) => new Set([...current, ...detail.findingIds]));
      setReviewed((current) => {
        const next = new Set(current);
        detail.findingIds.forEach((id) => next.delete(id));
        return next;
      });
    };
    window.addEventListener(DOCUMENT_REVIEW_REJECTED_EVENT, rejected);
    return () => window.removeEventListener(DOCUMENT_REVIEW_REJECTED_EVENT, rejected);
  }, [filePath]);

  const findings = useMemo(() => result?.findings.filter((item) => !dismissed.has(item.id)) ?? [], [dismissed, result]);
  const tooLarge = (content?.length ?? 0) > MAX_REVIEW_DOCUMENT_CHARACTERS;
  const canReview = Boolean(filePath && /\.(md|markdown)$/i.test(filePath) && content?.trim() && !tooLarge);

  const run = async () => {
    if (!selected || !filePath || content === null) return;
    const snapshot = content;
    setRunning(true); setResult(undefined); setReviewedContent(snapshot); setDismissed(new Set()); setReviewed(new Set());
    try {
      const next = await reviewDocument({ projectId, filePath, content: snapshot, reviewType: selected, tonePreset, styleReference: styleReference || undefined });
      setResult(next);
      if (selected === "tone" && !next.error) setToneSettingsOpen(false);
      if (next.error) toast.error(next.error);
      else if (next.warning) toast.warning(next.warning);
    } finally { setRunning(false); }
  };

  const reviewBase = reviewedContent ?? content;
  const applicable = findings.filter((finding) => isProposedEdit(finding) && reviewBase?.includes(finding.quote));
  const acceptedFindings = applicable.filter((finding) => reviewed.has(finding.id));
  const pendingFindings = applicable.filter((finding) => !reviewed.has(finding.id));
  const propose = (items: ReviewFinding[], mode: "stage" | "commit" = "stage") => {
    if (!filePath || reviewBase == null) return;
    const requested = mode === "stage"
      ? [...acceptedFindings, ...items.filter((item) => !reviewed.has(item.id))]
      : items;
    const applied = applyReviewFindings(reviewBase, requested);
    if (!applied.appliedIds.length) {
      return toast.message(applied.citationRejectedIds.length
        ? "The proposed edits changed citation tokens and were not applied."
        : "No unambiguous edits are available to apply.");
    }
    window.dispatchEvent(new CustomEvent<DocumentReviewProposalDetail>(DOCUMENT_REVIEW_PROPOSAL_EVENT, {
      detail: {
        filePath,
        baseContent: reviewBase,
        content: applied.content,
        findingIds: mode === "stage" ? items.map((item) => item.id) : applied.appliedIds,
        mode,
        focus: mode === "stage" && items.length === 1 && items[0].replacement
          ? { before: items[0].quote, after: items[0].replacement }
          : undefined,
      },
    }));
    if (applied.citationRejectedIds.length) {
      toast.warning(`${applied.citationRejectedIds.length} unsafe citation change${applied.citationRejectedIds.length === 1 ? " was" : "s were"} skipped.`);
    }
    if (mode === "stage") {
      toast.success(`${applied.appliedIds.length} change${applied.appliedIds.length === 1 ? "" : "s"} ready for review`);
    }
  };
  const openAnchor = (finding: ReviewFinding) => {
    if (!filePath) return;
    window.dispatchEvent(new CustomEvent<DocumentReviewAnchorDetail>(DOCUMENT_REVIEW_ANCHOR_EVENT, {
      detail: { filePath, quote: finding.quote },
    }));
  };
  const rejectFinding = (finding: ReviewFinding) => {
    setDismissed((current) => new Set(current).add(finding.id));
    setReviewed((current) => {
      const next = new Set(current);
      next.delete(finding.id);
      return next;
    });
    toast.message("Finding rejected", { description: "It is ignored for this review and the document is unchanged." });
  };

  useEffect(() => {
    const handleCitationApplied = (event: Event) => {
      const detail = (event as CustomEvent<ApplyCitationDetail>).detail;
      if (!detail || detail.filePath !== filePath) return;
      setDismissed((prev) => {
        const next = new Set(prev);
        result?.findings.forEach((finding) => {
          if (
            (detail.text && (finding.quote.includes(detail.text) || detail.text.includes(finding.quote))) ||
            (detail.range && content && content.slice(detail.range.from, detail.range.to).includes(finding.quote))
          ) {
            next.add(finding.id);
          }
        });
        return next;
      });
      toast.success("Citation added", { description: "Unverified claim finding resolved." });
    };
    window.addEventListener(APPLY_CITATION_EVENT, handleCitationApplied);
    return () => window.removeEventListener(APPLY_CITATION_EVENT, handleCitationApplied);
  }, [filePath, result, content]);

  const handleFindCitation = (finding: ReviewFinding) => {
    if (!filePath || !content) return;
    openAnchor(finding);

    const quoteIdx = content.indexOf(finding.quote);
    const range = quoteIdx >= 0
      ? { from: quoteIdx, to: quoteIdx + finding.quote.length }
      : { from: 0, to: finding.quote.length };

    window.dispatchEvent(
      new CustomEvent<FindCitationRequestDetail>(FIND_CITATION_REQUEST_EVENT, {
        detail: {
          projectId,
          draftFilePath: filePath,
          text: finding.quote.trim(),
          range,
        },
      }),
    );
  };

  if (!selected) return <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-10 shrink-0 items-center border-b px-3">
      <p className="text-xs font-medium text-muted-foreground">Choose a focused reviewer. Changes require your approval.</p>
    </div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-2 p-3">
      {OPTIONS.map(({ id, title, description, icon: Icon }) => <button key={id} type="button" onClick={() => { setSelected(id); setResult(undefined); if (id === "tone") setToneSettingsOpen(true); }} className="group flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/30 hover:bg-accent/45">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary"><Icon className="size-4.5" /></span>
        <span><span className="block text-sm font-medium">{title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span></span>
      </button>)}
    </div></ScrollArea>
  </div>;

  const option = OPTIONS.find((item) => item.id === selected)!;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
      <Button size="icon-sm" variant="ghost" onClick={() => { setSelected(undefined); setResult(undefined); setToneSettingsOpen(true); }} aria-label="Back to reviewers"><ChevronLeft className="size-4" /></Button>
      <p className="min-w-0 flex-1 truncate text-xs font-medium">{option.title}</p>
    </div>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-3 p-3">
      {selected === "tone" ? <div className="overflow-hidden rounded-xl border bg-muted/20">
        <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-accent/30" onClick={() => setToneSettingsOpen((open) => !open)} aria-expanded={toneSettingsOpen}>
          <span className="text-xs font-medium">Style Preset</span>
          {toneSettingsOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </button>
        {toneSettingsOpen ? <div className="px-3 pb-3"><div className="grid grid-cols-1 gap-1.5">{[
          { value: "formal-academic", label: "Academic & Formal", icon: GraduationCap },
          { value: "concise-scientific", label: "Scientific & Concise", icon: FlaskConical },
          { value: "clear-natural", label: "Clear & Natural", icon: Leaf },
        ].map(({ value, label, icon: Icon }) => (
          <button type="button" key={value} onClick={() => setTonePreset(value as typeof tonePreset)} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs", tonePreset === value ? "border-primary bg-primary/7 font-medium" : "bg-card hover:bg-accent/40")}>
            <Icon className={cn("size-3.5", tonePreset === value ? "text-primary" : "text-muted-foreground")} />
            {label}
          </button>
        ))}</div>
        <label className="mt-3 block text-xs font-medium">Optional Style Reference</label>
        <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs font-medium transition-colors hover:bg-accent/40">
          <FileUp className="size-3.5" />{styleReferenceName ? `Using ${styleReferenceName}` : "Upload Text or Markdown"}
          <input
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 100_000) {
                toast.error("Style references must be smaller than 100 KB.");
                event.target.value = "";
                return;
              }
              void file.text().then((text) => {
                setStyleReference(text.slice(0, 30_000));
                setStyleReferenceName(file.name);
              });
            }}
          />
        </label>
        <Textarea className="mt-2 min-h-24 text-xs" value={styleReference} onChange={(event) => setStyleReference(event.target.value)} placeholder="Paste a representative passage. Its characteristics, not its phrasing, will guide the review." /></div> : null}
      </div> : null}
      {!canReview ? <div className="rounded-xl border border-dashed p-4 text-center"><FileSearch className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 text-xs font-medium">{tooLarge ? `This document exceeds the ${MAX_REVIEW_DOCUMENT_CHARACTERS.toLocaleString()} character review limit.` : "Open a Markdown document to review it."}</p></div> : null}
      {!result ? <ReviewProgress type={selected} activeStep={progressStep} running={running} /> : null}
      {result && !running ? <>
        <div className="rounded-xl border bg-muted/20 p-3"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><p className="text-xs font-semibold">Review Summary</p></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{result.summary}</p></div>
        {acceptedFindings.length ? <Button className="w-full" size="sm" onClick={() => propose(acceptedFindings, "commit")}>Apply {acceptedFindings.length} Accepted Change{acceptedFindings.length === 1 ? "" : "s"}</Button> : null}
        {pendingFindings.length > 1 ? <Button className="w-full" size="sm" variant="outline" onClick={() => propose(pendingFindings, "stage")}>Review and Stage {pendingFindings.length} Remaining Changes</Button> : null}
        {acceptedFindings.length || dismissed.size ? <p className="text-center text-[11px] text-muted-foreground">{acceptedFindings.length} Accepted · {dismissed.size} Rejected · {pendingFindings.length} Pending</p> : null}
        <div className="space-y-2">{findings.map((finding) => {
          const accepted = reviewed.has(finding.id);
          return <FindingCard key={finding.id} finding={finding} reviewed={accepted} onDismiss={() => rejectFinding(finding)} onOpen={() => accepted || !isProposedEdit(finding) ? openAnchor(finding) : propose([finding], "stage")} onUnstage={() => setReviewed((current) => { const next = new Set(current); next.delete(finding.id); return next; })} onFindCitation={() => handleFindCitation(finding)} />;
        })}</div>
        {!findings.length && !result.error ? <p className="py-8 text-center text-xs text-muted-foreground">No actionable issues found.</p> : null}
      </> : null}
    </div></ScrollArea>
    <div className="border-t p-3"><Button className="w-full" disabled={!selected || !canReview || running} onClick={() => void run()}>{running ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{result && !result.error ? `Rerun ${option.title}` : `Run ${option.title}`}</Button></div>
  </div>;
}

function ReviewProgress({ type, activeStep, running }: { type: ReviewType; activeStep: number; running: boolean }) {
  return <div className="rounded-xl border border-dashed p-4">
    <div className="flex items-center gap-2">
      {running ? <Loader2 className="size-4 animate-spin text-primary" /> : <ShieldCheck className="size-4 text-primary" />}
      <p className="text-sm font-medium">{running ? "Reviewing Document…" : "What this review will do"}</p>
    </div>
    <ol className="mt-4 space-y-3">{PROGRESS_STEPS[type].map((label, index) => {
      const done = running && index < activeStep; const active = running && index === activeStep;
      return <li key={label} className={cn("flex items-center gap-2.5 text-xs", done ? "text-foreground" : active ? "font-medium text-primary" : "text-muted-foreground/60")}>
        {done ? <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"><Check className="size-3" /></span> : active ? <span className="flex size-5 items-center justify-center"><Loader2 className="size-4 animate-spin" /></span> : <span className="flex size-5 items-center justify-center"><Circle className="size-3" /></span>}
        <span>{label}</span>
      </li>;
    })}</ol>
  </div>;
}

function FindingCard({ finding, reviewed, onDismiss, onOpen, onUnstage, onFindCitation }: { finding: ReviewFinding; reviewed: boolean; onDismiss: () => void; onOpen: () => void; onUnstage: () => void; onFindCitation?: () => void }) {
  const edit = isProposedEdit(finding);
  const isCitationIssue =
    finding.category === "source_support" ||
    finding.category === "citation_needed" ||
    finding.category === "unsupported_claim" ||
    finding.message.toLowerCase().includes("citation") ||
    finding.message.toLowerCase().includes("source support");

  return <article role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }} className={cn("cursor-pointer rounded-xl border bg-card p-3 transition-colors hover:border-primary/35 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", reviewed && "border-emerald-500/25 bg-emerald-500/[0.03]")}>
    <div className="flex items-center gap-2"><SeverityIcon severity={finding.severity} /><span className="min-w-0 flex-1 text-[11px] font-medium leading-6 text-muted-foreground">{finding.category}</span><button type="button" title="Reject this finding" onClick={(event) => { event.stopPropagation(); onDismiss(); }} aria-label="Reject this finding" className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button></div>
    <div className="mt-2 line-clamp-4 border-l-2 border-primary/30 pl-2 text-xs leading-5 text-muted-foreground"><ReviewMarkdown>{finding.quote}</ReviewMarkdown></div>
    <p className="mt-2 text-xs leading-5">{finding.message}</p>
    {edit ? <div className="mt-2 rounded-lg bg-emerald-500/7 p-2 text-xs leading-5"><p className="mb-1 font-medium text-emerald-700 dark:text-emerald-400">Suggestion</p><ReviewMarkdown>{finding.replacement!}</ReviewMarkdown></div> : null}
    <div className="mt-2.5 flex items-center justify-between gap-2 pt-1.5 border-t border-border/40">
      {isCitationIssue ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="h-6 gap-1 px-2 text-[11px] border-primary/30 text-primary hover:bg-primary/10 shadow-2xs"
          onClick={(event) => {
            event.stopPropagation();
            onFindCitation?.();
          }}
          title="Search your project bibliography to support this statement"
        >
          <Sparkles className="size-3" />
          Find in Bibliography
        </Button>
      ) : <div />}

      {edit && reviewed ? <Button size="xs" variant="outline" onClick={(event) => { event.stopPropagation(); onUnstage(); }}>
        <CheckCheck />Accepted · Undo</Button> : null}
    </div>
  </article>;
}

function isProposedEdit(finding: ReviewFinding) {
  return Boolean(finding.replacement && finding.replacement.trim() !== finding.quote.trim());
}

function ReviewMarkdown({ children }: { children: string }) {
  return <Streamdown className="review-card-markdown">{children}</Streamdown>;
}

function SeverityIcon({ severity }: { severity: ReviewFinding["severity"] }) {
  const styles = severity === "critical"
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : severity === "warning"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400";
  const Icon = severity === "critical" ? OctagonAlert : severity === "warning" ? TriangleAlert : Info;
  return <span title={severity} aria-label={`${severity} severity`} className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", styles)}><Icon className="size-3.5" /></span>;
}
