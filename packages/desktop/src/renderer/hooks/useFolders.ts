import { useState, useEffect, useCallback } from "react";
import type { Folder } from "@stratosapp/core";

interface UseFoldersReturn {
  folders: Folder[];
  addFolder: (path: string, name?: string) => Promise<Folder>;
  removeFolder: (folderId: string) => Promise<void>;
  updateFolder: (folderId: string, updates: Partial<Folder>) => Promise<void>;
  refreshFolders: () => Promise<void>;
}

export function useFolders(): UseFoldersReturn {
  const [folders, setFolders] = useState<Folder[]>([]);

  const refreshFolders = useCallback(async () => {
    const list = await window.api.foldersList();
    setFolders(list);
  }, []);

  useEffect(() => {
    refreshFolders();
  }, [refreshFolders]);

  const addFolder = useCallback(
    async (path: string, name?: string) => {
      const folder = await window.api.foldersAdd(path, name);
      await refreshFolders();
      return folder;
    },
    [refreshFolders],
  );

  const removeFolder = useCallback(
    async (folderId: string) => {
      await window.api.foldersRemove(folderId);
      await refreshFolders();
    },
    [refreshFolders],
  );

  const updateFolder = useCallback(
    async (folderId: string, updates: Partial<Folder>) => {
      await window.api.foldersUpdate(folderId, updates);
      await refreshFolders();
    },
    [refreshFolders],
  );

  return { folders, addFolder, removeFolder, updateFolder, refreshFolders };
}
