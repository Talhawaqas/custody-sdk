// examples/FileManagerWidget.jsx
//
// Browser-based usage of InayaKernel.Metadata (the off-chain layer for
// rename/move/delete/virtual folders/sharing — see SDK_GUIDE.md §9). Pairs
// with the reference backend in examples/nextjs-metadata-api-routes.js.
//
// This is deliberately a separate component from ReactUploadWidget.jsx:
// that one anchors a new file to the chain; this one manages the mutable
// metadata layer for files that are already anchored. A real app likely
// renders both together, anchoring a file and then calling
// registerFileMetadata() with the resulting fileHash.
//
// Requires: npm install @inaya-network/custody-sdk ethers react

import { useState, useEffect, useCallback } from "react";
import { InayaKernel } from "@inaya-network/custody-sdk";

export default function FileManagerWidget({ connection }) {
  const [currentFolderId, setCurrentFolderId] = useState(null); // null = root
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!connection?.address) return;
    try {
      const [{ files }, { folders }] = await Promise.all([
        InayaKernel.Metadata.listFiles({ owner: connection.address, folderId: currentFolderId }),
        InayaKernel.Metadata.listFolders({ owner: connection.address, parentFolderId: currentFolderId }),
      ]);
      setFiles(files);
      setFolders(folders);
    } catch (err) {
      setError(err.message);
    }
  }, [connection, currentFolderId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt("Folder name:");
    if (!name) return;
    try {
      await InayaKernel.Metadata.createFolder({ connection, name, parentFolderId: currentFolderId });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }, [connection, currentFolderId, refresh]);

  const handleRename = useCallback(async (fileHash, oldName) => {
    const newName = window.prompt("New name:", oldName);
    if (!newName || newName === oldName) return;
    try {
      await InayaKernel.Metadata.renameFile({ connection, fileHash, newName });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }, [connection, refresh]);

  const handleMoveToFolder = useCallback(async (fileHash, folderId) => {
    try {
      await InayaKernel.Metadata.moveFile({ connection, fileHash, folderId });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }, [connection, refresh]);

  const handleDelete = useCallback(async (fileHash) => {
    if (!window.confirm("Delete this file's metadata? (The on-chain record and shards are untouched — this only hides it from your listing.)")) return;
    try {
      await InayaKernel.Metadata.deleteFile({ connection, fileHash });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }, [connection, refresh]);

  const handleShare = useCallback(async (fileHash) => {
    const granteeAddress = window.prompt("Share with wallet address:");
    if (!granteeAddress) return;
    try {
      // In a real app, re-wrap the file's vault key for granteeAddress here (e.g. via their
      // MetaMask encryption public key) — this SDK deliberately doesn't do that step for you.
      // wrappedVaultKey is opaque to this module; it just stores and returns it verbatim.
      const wrappedVaultKey = "placeholder-see-comment-above";
      await InayaKernel.Metadata.shareFile({ connection, fileHash, granteeAddress, wrappedVaultKey });
    } catch (err) {
      setError(err.message);
    }
  }, [connection]);

  if (!connection) return <p>Connect a wallet first.</p>;

  return (
    <div style={{ maxWidth: 560, fontFamily: "monospace" }}>
      <div>
        {currentFolderId && <button onClick={() => setCurrentFolderId(null)}>&larr; Root</button>}
        <button onClick={handleCreateFolder}>New Folder</button>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <ul>
        {folders.map((folder) => (
          <li key={folder.folderId}>
            <button onClick={() => setCurrentFolderId(folder.folderId)}>📁 {folder.name}</button>
          </li>
        ))}
        {files.map((file) => (
          <li key={file.fileHash}>
            {file.filename}
            <button onClick={() => handleRename(file.fileHash, file.filename)}>Rename</button>
            {currentFolderId && <button onClick={() => handleMoveToFolder(file.fileHash, null)}>Move to root</button>}
            <button onClick={() => handleShare(file.fileHash)}>Share</button>
            <button onClick={() => handleDelete(file.fileHash)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
