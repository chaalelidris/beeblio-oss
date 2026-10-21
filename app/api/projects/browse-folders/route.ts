import { NextResponse } from "next/server";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { getUser } from "@/lib/auth/session";

function getProjectsRoot(): string {
  if (process.env.BEEBLIO_PROJECTS_ROOT) {
    return path.resolve(process.env.BEEBLIO_PROJECTS_ROOT);
  }
  // In Docker, default to /projects if directory exists
  if (existsSync("/projects")) {
    return "/projects";
  }
  // Fallback to ./projects relative to workspace root
  return path.resolve("./projects");
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function GET(req: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rootPath = getProjectsRoot();
    await fs.mkdir(rootPath, { recursive: true });

    const url = new URL(req.url);
    const requestedPath = url.searchParams.get("path");

    let targetPath = requestedPath ? path.resolve(requestedPath) : rootPath;

    // Security check: ensure path is within or equal to rootPath
    if (targetPath !== rootPath && !isWithinRoot(targetPath, rootPath)) {
      targetPath = rootPath;
    }

    // Verify directory exists
    try {
      const stat = await fs.stat(targetPath);
      if (!stat.isDirectory()) {
        targetPath = rootPath;
      }
    } catch {
      targetPath = rootPath;
    }

    const dirents = await fs.readdir(targetPath, { withFileTypes: true });
    const folders = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => {
        const fullPath = path.join(targetPath, d.name).replace(/\\/g, "/");
        return {
          name: d.name,
          path: fullPath,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // Calculate breadcrumbs
    const relative = path.relative(rootPath, targetPath);
    const breadcrumbs = [
      { name: "projects", path: rootPath.replace(/\\/g, "/") },
    ];

    if (relative && relative !== ".") {
      const parts = relative.split(path.sep);
      let accumulated = rootPath;
      for (const part of parts) {
        accumulated = path.join(accumulated, part);
        breadcrumbs.push({
          name: part,
          path: accumulated.replace(/\\/g, "/"),
        });
      }
    }

    const parentPath =
      targetPath !== rootPath
        ? path.dirname(targetPath).replace(/\\/g, "/")
        : null;

    return NextResponse.json({
      rootPath: rootPath.replace(/\\/g, "/"),
      currentPath: targetPath.replace(/\\/g, "/"),
      parentPath,
      breadcrumbs,
      folders,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to browse folders",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rootPath = getProjectsRoot();
    const body = (await req.json()) as {
      parentPath?: unknown;
      folderName?: unknown;
    };

    if (typeof body.folderName !== "string" || !body.folderName.trim()) {
      return NextResponse.json(
        { error: "Folder name is required" },
        { status: 400 },
      );
    }

    const folderName = body.folderName.trim();
    // Validate folder name has no path separators or traversal
    if (
      folderName.includes("/") ||
      folderName.includes("\\") ||
      folderName === ".." ||
      folderName === "."
    ) {
      return NextResponse.json(
        { error: "Invalid folder name" },
        { status: 400 },
      );
    }

    const parentPath =
      typeof body.parentPath === "string" && body.parentPath.trim()
        ? path.resolve(body.parentPath.trim())
        : rootPath;

    if (parentPath !== rootPath && !isWithinRoot(parentPath, rootPath)) {
      return NextResponse.json(
        { error: "Parent path is outside allowed directory" },
        { status: 403 },
      );
    }

    const newFolderPath = path.join(parentPath, folderName);
    if (existsSync(newFolderPath)) {
      return NextResponse.json(
        { error: "Folder already exists" },
        { status: 409 },
      );
    }

    await fs.mkdir(newFolderPath, { recursive: true });

    return NextResponse.json({
      success: true,
      folderPath: newFolderPath.replace(/\\/g, "/"),
      folderName,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create folder",
      },
      { status: 500 },
    );
  }
}
