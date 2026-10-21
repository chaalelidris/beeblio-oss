"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Folder,
  FolderPlus,
  ChevronRight,
  CornerLeftUp,
  Check,
  Loader2,
  HardDrive,
  Plus,
} from "lucide-react";

interface BreadcrumbItem {
  name: string;
  path: string;
}

interface FolderItem {
  name: string;
  path: string;
}

interface FolderBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFolder: (folderPath: string) => void;
  initialPath?: string;
}

export function FolderBrowserDialog({
  open,
  onOpenChange,
  onSelectFolder,
  initialPath,
}: FolderBrowserDialogProps) {
  const [currentPath, setCurrentPath] = useState<string>(initialPath || "");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // New folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>("");
  const [creatingLoading, setCreatingLoading] = useState<boolean>(false);

  const fetchDirectory = useCallback(async (dirPath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = dirPath
        ? `/api/projects/browse-folders?path=${encodeURIComponent(dirPath)}`
        : "/api/projects/browse-folders";
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load directory");
        return;
      }

      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setBreadcrumbs(data.breadcrumbs || []);
      setFolders(data.folders || []);
      setSelectedPath(data.currentPath);
      setIsCreatingFolder(false);
      setNewFolderName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error connecting to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchDirectory(initialPath || undefined);
    }
  }, [open, initialPath, fetchDirectory]);

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setCreatingLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/browse-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentPath: currentPath,
          folderName: newFolderName.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create folder");
        return;
      }

      setIsCreatingFolder(false);
      setNewFolderName("");
      await fetchDirectory(currentPath);
      if (data.folderPath) {
        setSelectedPath(data.folderPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creating folder");
    } finally {
      setCreatingLoading(false);
    }
  }

  function handleConfirm() {
    if (selectedPath) {
      onSelectFolder(selectedPath);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <HardDrive className="h-5 w-5 text-primary" />
            <span>Select Project Folder</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Browse and pick a folder from your computer mounted into the container.
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumb Navigation */}
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-2 text-xs font-mono">
          {breadcrumbs.map((crumb, idx) => (
            <div key={crumb.path} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <button
                type="button"
                onClick={() => fetchDirectory(crumb.path)}
                className={`rounded px-1.5 py-0.5 hover:bg-muted ${
                  idx === breadcrumbs.length - 1
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* Action Bar (Up level & New Folder) */}
        <div className="flex items-center justify-between gap-2">
          {parentPath ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fetchDirectory(parentPath)}
              disabled={loading}
              className="h-8 text-xs"
            >
              <CornerLeftUp className="mr-1 h-3.5 w-3.5" />
              Up one level
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Root directory</span>
          )}

          {!isCreatingFolder ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsCreatingFolder(true)}
              disabled={loading}
              className="h-8 text-xs"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New Folder
            </Button>
          ) : null}
        </div>

        {/* Inline New Folder Form */}
        {isCreatingFolder && (
          <form
            onSubmit={handleCreateFolder}
            className="flex items-center gap-2 rounded-md border border-primary/40 bg-card p-2"
          >
            <FolderPlus className="h-4 w-4 shrink-0 text-primary" />
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="folder-name"
              className="h-8 text-xs"
              autoFocus
              disabled={creatingLoading}
            />
            <Button
              type="submit"
              size="sm"
              disabled={creatingLoading || !newFolderName.trim()}
              className="h-8 text-xs"
            >
              {creatingLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsCreatingFolder(false);
                setNewFolderName("");
              }}
              disabled={creatingLoading}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
          </form>
        )}

        {/* Error message */}
        {error && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Folder List */}
        <ScrollArea className="h-56 rounded-md border bg-card p-2">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-xs">Loading folders...</span>
            </div>
          ) : folders.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Folder className="h-8 w-8 stroke-1 text-muted-foreground/60" />
              <p className="text-xs">No subfolders in this directory.</p>
              <p className="text-[11px] text-muted-foreground/80">
                You can select this directory or click &quot;New Folder&quot; above.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {folders.map((folder) => {
                const isSelected = selectedPath === folder.path;
                return (
                  <div
                    key={folder.path}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted text-foreground"
                    }`}
                    onClick={() => setSelectedPath(folder.path)}
                    onDoubleClick={() => fetchDirectory(folder.path)}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Folder className={`h-4 w-4 shrink-0 ${isSelected ? "text-primary fill-primary/20" : "text-muted-foreground"}`} />
                      <span className="truncate">{folder.name}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 text-primary mr-1" />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchDirectory(folder.path);
                        }}
                        title="Open folder"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Selected path readout */}
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Selected Path:</span>
          <span className="font-mono text-[11px] font-semibold text-foreground truncate max-w-[320px]">
            {selectedPath || currentPath || "None"}
          </span>
        </div>

        <DialogFooter className="mt-2 flex items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={!selectedPath}
          >
            Select This Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
