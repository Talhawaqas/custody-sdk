// packages/react/src/InayaFileBrowser.jsx
//
// A decentralized-Drive-style browser consuming the SDK's Metadata client
// (folder management / rename / move / delete / share — see
// custody-sdk/SDK_GUIDE.md §9 for why this is an off-chain layer: Custody
// itself is write-once, confirmed by live eth_call testing).

import { useState, useEffect, useCallback } from "react";
import { InayaKernel } from "@inaya-network/custody-sdk";

export default function InayaFileBrowser({ connection, owner, apiBaseUrl = "", className = "" }) {
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]); // [{ folderId, name }]
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [renamingHash, setRenamingHash] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!owner) return;
    try {
      const [{ files }, { folders }] = await Promise.all([
        InayaKernel.Metadata.listFiles({ owner, folderId: currentFolderId, apiBaseUrl }),
        InayaKernel.Metadata.listFolders({ owner, parentFolderId: currentFolderId, apiBaseUrl }),
      ]);
      setFiles(files);
      setFolders(folders);
    } catch (err) {
      setError(err.message);
    }
  }, [owner, currentFolderId, apiBaseUrl]);

  useEffect(() => { refresh(); }, [refresh]);

  const openFolder = (folder) => {
    setBreadcrumb((b) => [...b, { folderId: currentFolderId, name: folder.name }]);
    setCurrentFolderId(folder.folderId);
  };
  const goToRoot = () => { setBreadcrumb([]); setCurrentFolderId(null); };
  const goUp = () => {
    const next = breadcrumb.slice(0, -1);
    setBreadcrumb(next);
    setCurrentFolderId(next.length ? next[next.length - 1].folderId : null);
  };

  const handleCreateFolder = async () => {
    const name = window.prompt("Folder name:");
    if (!name) return;
    try {
      await InayaKernel.Metadata.createFolder({ connection, name, parentFolderId: currentFolderId, apiBaseUrl });
      await refresh();
    } catch (err) { setError(err.message); }
  };

  const startRename = (file) => { setRenamingHash(file.fileHash); setRenameValue(file.filename); };
  const commitRename = async (fileHash) => {
    try {
      await InayaKernel.Metadata.renameFile({ connection, fileHash, newName: renameValue, apiBaseUrl });
      setRenamingHash(null);
      await refresh();
    } catch (err) { setError(err.message); }
  };

  const handleMoveToRoot = async (fileHash) => {
    try {
      await InayaKernel.Metadata.moveFile({ connection, fileHash, folderId: null, apiBaseUrl });
      await refresh();
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (fileHash) => {
    if (!window.confirm("Delete this file's metadata? The on-chain record and encrypted shards are untouched.")) return;
    try {
      await InayaKernel.Metadata.deleteFile({ connection, fileHash, apiBaseUrl });
      await refresh();
    } catch (err) { setError(err.message); }
  };

  const handleShare = async (fileHash) => {
    const granteeAddress = window.prompt("Share with wallet address:");
    if (!granteeAddress) return;
    try {
      // Re-wrap the vault key for granteeAddress in your own app before calling this in
      // production — this component (like the SDK itself) doesn't do that key exchange for you.
      await InayaKernel.Metadata.shareFile({ connection, fileHash, granteeAddress, wrappedVaultKey: "unwrapped-placeholder", apiBaseUrl });
    } catch (err) { setError(err.message); }
  };

  return (
    <div className={`rounded-xl border border-white/10 bg-black/20 p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <button onClick={goToRoot} className="hover:text-cyan-400">Root</button>
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              <span>/</span>
              <span>{b.name}</span>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          {currentFolderId && (
            <button onClick={goUp} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-cyan-400/50">&larr; Up</button>
          )}
          <button onClick={handleCreateFolder} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-cyan-400/50">+ Folder</button>
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {folders.map((folder) => (
          <button
            key={folder.folderId}
            onClick={() => openFolder(folder)}
            className="flex flex-col items-start gap-1 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-left hover:border-cyan-400/40"
          >
            <span className="text-lg">📁</span>
            <span className="truncate text-xs text-slate-200">{folder.name}</span>
          </button>
        ))}

        {files.map((file) => (
          <div key={file.fileHash} className="group relative flex flex-col gap-1 rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <span className="text-lg">📄</span>
            {renamingHash === file.fileHash ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(file.fileHash)}
                onKeyDown={(e) => e.key === "Enter" && commitRename(file.fileHash)}
                className="rounded border border-cyan-400 bg-black/40 px-1 text-xs text-slate-100 outline-none"
              />
            ) : (
              <span onClick={() => startRename(file)} className="cursor-text truncate text-xs text-slate-200" title="Click to rename">
                {file.filename}
              </span>
            )}
            <div className="mt-1 hidden gap-1 group-hover:flex">
              {currentFolderId && (
                <button onClick={() => handleMoveToRoot(file.fileHash)} className="text-[10px] text-slate-400 hover:text-cyan-400">Move to root</button>
              )}
              <button onClick={() => handleShare(file.fileHash)} className="text-[10px] text-slate-400 hover:text-cyan-400">Share</button>
              <button onClick={() => handleDelete(file.fileHash)} className="text-[10px] text-slate-400 hover:text-red-400">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {folders.length === 0 && files.length === 0 && (
        <p className="py-6 text-center text-xs text-slate-500">This folder is empty.</p>
      )}
    </div>
  );
}
