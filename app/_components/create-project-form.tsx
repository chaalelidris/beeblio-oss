"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FolderBrowserDialog } from "./folder-browser-dialog";

export function CreateProjectForm({ customTrigger }: { customTrigger?: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [open, setOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserInitialPath, setBrowserInitialPath] = useState("");
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");

  function applySelectedFolder(selected: string) {
    setFolderPath(selected);
    if (!name.trim()) {
      const folderName = selected.split(/[/\\]/).filter(Boolean).pop();
      if (folderName) setName(folderName);
    }
  }

  async function chooseFolder() {
    setSelectingFolder(true);
    try {
      if (window.beeblioDesktop) {
        const selected = await window.beeblioDesktop.selectFolder();
        if (selected) applySelectedFolder(selected);
        return;
      }
      const response = await fetch("/api/projects/select-folder", { method: "POST" });
      const result = await response.json();
      if (response.ok && result.mode === "browser") {
        setBrowserInitialPath(result.rootPath || "");
        setBrowserOpen(true);
        return;
      }
      if (response.ok && typeof result.folderPath === "string") {
        applySelectedFolder(result.folderPath);
      } else if (result.error && response.status !== 400) {
        // If native dialog fails (e.g. headless Linux or Docker without env var), fallback to in-app browser
        setBrowserInitialPath("/projects");
        setBrowserOpen(true);
      }
    } catch {
      setBrowserInitialPath("/projects");
      setBrowserOpen(true);
    } finally {
      setSelectingFolder(false);
    }
  }
  
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      const name = formData.get("name") as string;
      const description = formData.get("description") as string;
      const folderPath = formData.get("folderPath") as string;
      
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, folderPath }),
      });
      
      const result = await res.json();
      
      if (res.ok && result.success && result.destinationUrl) {
        setOpen(false);
        window.localStorage.setItem("beeblio:workspace-rail-expanded", "false");
        router.push(result.destinationUrl);
      } else {
        alert(result.error || "Failed to create project");
        setLoading(false);
      }
    } catch (e) {
      console.error(e);
      alert(String(e));
      setLoading(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        setName("");
        setFolderPath("");
      }
    }}>
      <DialogTrigger asChild>
        {customTrigger ? customTrigger : (
          <Button className="h-10 shrink-0 whitespace-nowrap shadow-sm">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New</span>
            <span className="inline sm:hidden">Project</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Link Project Folder</DialogTitle>
          {/* <DialogDescription>
            Set up a focused space for sources, analysis, and ongoing questions.
          </DialogDescription> */}
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="name" className="text-sm font-medium">
              Project Name
            </label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Urban heat and public health"
              required
              disabled={loading || selectingFolder}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="folderPath" className="text-sm font-medium">Project folder</label>
            <div className="flex gap-2">
              <Input
                id="folderPath"
                name="folderPath"
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                placeholder="/absolute/path/to/folder"
                required
                disabled={loading || selectingFolder}
              />
              <Button
                type="button"
                variant="outline"
                onClick={chooseFolder}
                disabled={loading || selectingFolder}
              >
                {selectingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : "Browse"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Files are stored in this folder. In Docker, select a folder within <code className="rounded bg-muted px-1 font-mono">/projects</code> (mounted from <code className="rounded bg-muted px-1 font-mono">./projects</code> on your computer).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="description" className="text-sm font-medium">
              Research Focus <span className="font-normal text-muted-foreground">(Optional)</span>
            </label>
            <Textarea 
              id="description" 
              name="description" 
              placeholder="What question, topic, or outcome is guiding this work?"
              className="resize-none"
              rows={3}
              disabled={loading} 
            />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Link Folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <FolderBrowserDialog
      open={browserOpen}
      onOpenChange={setBrowserOpen}
      initialPath={browserInitialPath || folderPath}
      onSelectFolder={(selected) => applySelectedFolder(selected)}
    />
    </>
  );
}

