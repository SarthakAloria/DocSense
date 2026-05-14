"use client";

/**
 * page.tsx — Main chat interface for DocSearch AI
 *
 * Responsibilities:
 *  - Render the sidebar (document tree, chat history, settings)
 *  - Render the chat area (message bubbles, loading indicator, empty state)
 *  - Render the input bar (textarea + upload button + send button)
 *  - Persist chat history to localStorage
 *  - Fetch the document tree from /api/documents
 *  - POST questions to /api/query and display answers
 *  - POST files to /api/upload and refresh the document tree
 *  - POST to /api/setup to build / rebuild the Pinecone index
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
}

interface DocNode {
  name: string;
  type: "folder" | "file";
  path: string;
  children?: DocNode[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a collision-resistant random ID by combining Math.random() with Date.now(). */
function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Returns an emoji icon that matches a file's extension. */
function getFileIcon(name: string) {
  if (name.endsWith(".pdf")) return "📄";
  if (name.endsWith(".md")) return "📝";
  return "📃";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * DocTree — Recursive file-explorer component.
 *
 * Renders a list of DocNode items.  Folder nodes are toggleable; clicking a
 * file node selects it (or deselects it if it is already selected).
 */
function DocTree({
  nodes,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  nodes: DocNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  // Tracks which folder paths are currently expanded.
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  const toggle = (p: string) =>
    setOpenFolders((prev) => ({ ...prev, [p]: !prev[p] }));

  return (
    <ul style={{ paddingLeft: depth > 0 ? "12px" : "0" }}>
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "folder" ? (
            <>
              {/* Folder row — clicking toggles open/closed */}
              <button
                onClick={() => toggle(node.path)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  width: "100%",
                  padding: "5px 8px",
                  borderRadius: "6px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: "12px",
                  fontFamily: "var(--font-syne), sans-serif",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  textAlign: "left",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--text-primary)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--text-muted)")
                }
              >
                <span style={{ fontSize: "10px", opacity: 0.7 }}>
                  {openFolders[node.path] ? "▾" : "▸"}
                </span>
                <span>📁</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {node.name}
                </span>
              </button>

              {/* Recursively render children when the folder is open */}
              {openFolders[node.path] && node.children && (
                <DocTree
                  nodes={node.children}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              )}
            </>
          ) : (
            /* File row — clicking selects or deselects the file */
            <button
              onClick={() => onSelect(node.path === selectedPath ? "" : node.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                width: "100%",
                padding: "4px 8px",
                borderRadius: "6px",
                background:
                  selectedPath === node.path
                    ? "var(--accent-subtle)"
                    : "none",
                border: "none",
                cursor: "pointer",
                color:
                  selectedPath === node.path
                    ? "var(--accent)"
                    : "var(--text-secondary)",
                fontSize: "12.5px",
                fontFamily: "var(--font-dm-sans), sans-serif",
                textAlign: "left",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (selectedPath !== node.path)
                  e.currentTarget.style.background = "var(--surface-hover)";
              }}
              onMouseLeave={(e) => {
                if (selectedPath !== node.path)
                  e.currentTarget.style.background = "none";
              }}
            >
              <span>{getFileIcon(node.name)}</span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {node.name}
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * MessageBubble — Renders a single chat message.
 *
 * User messages are right-aligned with a dark bubble; assistant messages are
 * left-aligned with an avatar icon and a lighter bubble.
 */
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: "20px",
        animation: "fadeSlideIn 0.25s ease",
      }}
    >
      {/* Avatar shown only for assistant messages */}
      {!isUser && (
        <div
          style={{
            width: "30px",
            height: "30px",
            borderRadius: "50%",
            background: "var(--accent-subtle)",
            border: "1.5px solid var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            flexShrink: 0,
            marginRight: "10px",
            marginTop: "2px",
          }}
        >
          ✦
        </div>
      )}

      {/* Message content bubble */}
      <div
        style={{
          maxWidth: "72%",
          padding: isUser ? "10px 16px" : "14px 18px",
          borderRadius: isUser ? "18px 18px 4px 18px" : "4px 18px 18px 18px",
          background: isUser ? "var(--user-bubble)" : "var(--ai-bubble)",
          border: isUser ? "none" : "1px solid var(--border)",
          color: "var(--text-primary)",
          fontSize: "14.5px",
          lineHeight: "1.7",
          fontFamily: "var(--font-dm-sans), sans-serif",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Home() {
  // ── State ──────────────────────────────────────────────────────────────────

  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<DocNode[]>([]);
  const [selectedDoc, setSelectedDoc] = useState("");
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [setupStatus, setSetupStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadToast, setUploadToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────────

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * FIX #4 — Skip the first localStorage save.
   *
   * Without this guard, the save useEffect fires on the initial render with
   * chats=[] (before the load effect's setChats re-render), overwriting any
   * previously stored history with an empty array.
   */
  const hasLoadedRef = useRef(false);

  // ── Persistence ────────────────────────────────────────────────────────────

  /**
   * On mount: load persisted chats from localStorage and fetch the document
   * tree.  Wrapped in a try/catch so corrupted localStorage never crashes the
   * app (FIX #3).
   */
  useEffect(() => {
    try {
      const saved = localStorage.getItem("docsearch_chats");
      if (saved) setChats(JSON.parse(saved)); // FIX #3 — try/catch prevents JSON.parse crash
    } catch {
      // localStorage value was corrupted; start fresh
      localStorage.removeItem("docsearch_chats");
    }
    fetchDocuments();
  }, []);

  /**
   * Persist chats whenever they change.
   *
   * FIX #4 — `hasLoadedRef` skips the very first run (initial render with
   * chats=[]) so we never overwrite the data we're about to load.
   */
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      return;
    }
    localStorage.setItem("docsearch_chats", JSON.stringify(chats));
  }, [chats]);

  /** Auto-scroll to the latest message whenever chat content changes. */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, currentChatId, loading]);

  /** Auto-resize the textarea up to 180 px as the user types. */
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 180) + "px";
    }
  }, [query]);

  // ── Data fetching ──────────────────────────────────────────────────────────

  /**
   * Fetches the document tree from the /api/documents endpoint and stores it
   * in state.  Wrapped in useCallback so it is stable across renders and safe
   * to use inside useEffect dependency arrays (FIX #5).
   */
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      const json = await res.json();
      setDocuments(json.documents ?? []);
    } catch {
      setDocuments([]);
    }
  }, []); // no deps — only calls an API and sets state

  // Derive the currently selected chat object from the chat list.
  const currentChat = chats.find((c) => c.id === currentChatId) ?? null;

  // ── Chat management ────────────────────────────────────────────────────────

  /** Creates a new empty chat, pushes it to the top of the list, and selects it. */
  const createNewChat = useCallback(() => {
    const id = genId();
    const newChat: Chat = {
      id,
      title: "New chat",
      messages: [],
      createdAt: new Date().toISOString(),
    };
    setChats((prev) => [newChat, ...prev]);
    setCurrentChatId(id);
    setQuery("");
    textareaRef.current?.focus();
  }, []);

  /** Removes a chat by ID. If the deleted chat is active, clears the selection. */
  const deleteChat = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation(); // prevent the parent div's onClick from firing
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (currentChatId === id) setCurrentChatId(null);
    },
    [currentChatId]
  );

  // ── Query sending ──────────────────────────────────────────────────────────

  /**
   * Sends the current query to /api/query.
   *
   * Steps:
   *  1. Guard against empty input or an in-flight request.
   *  2. Create a new chat if none is selected.
   *  3. Append the user message to the active chat optimistically.
   *  4. Optionally prepend a selected-document context hint to the question.
   *  5. POST to /api/query (FIX #2 — was incorrectly /api/read).
   *  6. Append the AI response (or an error message) to the chat.
   *  7. Always clear the loading state in finally.
   */
  const sendQuery = async () => {
    if (!query.trim() || loading) return;

    let chatId = currentChatId;

    // Auto-create a chat when none is selected.
    if (!chatId) {
      const id = genId();
      const newChat: Chat = {
        id,
        title: query.slice(0, 45),
        messages: [],
        createdAt: new Date().toISOString(),
      };
      setChats((prev) => [newChat, ...prev]);
      setCurrentChatId(id);
      chatId = id;
    }

    // Append user message optimistically.
    const userMsg: Message = {
      id: genId(),
      role: "user",
      content: query,
    };

    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              // Set the chat title from the first message.
              title:
                c.messages.length === 0 ? query.slice(0, 45) : c.title,
              messages: [...c.messages, userMsg],
            }
          : c
      )
    );

    // Prepend selected doc context to the question sent to the API.
    const fullQuestion = selectedDoc
      ? `[Context: searching in "${selectedDoc}"]\n${query}`
      : query;

    setQuery("");
    setLoading(true);

    try {
      /**
       * FIX #2 — Endpoint was "/api/read" which does not exist.
       * The correct route for querying Pinecone is "/api/query".
       */
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullQuestion),
      });
      const json = await res.json();

      const aiMsg: Message = {
        id: genId(),
        role: "assistant",
        content: json.data ?? json.error ?? "No response received.",
      };

      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? { ...c, messages: [...c.messages, aiMsg] }
            : c
        )
      );
    } catch {
      // Network / parsing error — show a friendly error bubble.
      const errMsg: Message = {
        id: genId(),
        role: "assistant",
        content: "Something went wrong. Please try again.",
      };
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? { ...c, messages: [...c.messages, errMsg] }
            : c
        )
      );
    } finally {
      // Always clear the loading state regardless of success or failure.
      setLoading(false);
    }
  };

  /**
   * Keyboard handler for the textarea.
   * Enter (without Shift) submits the query; Shift+Enter inserts a newline.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuery();
    }
  };

  // ── Index setup ────────────────────────────────────────────────────────────

  /**
   * Triggers /api/setup to load documents into Pinecone.
   * Shows a transient status indicator that resets to "idle" after 5 seconds.
   */
  const runSetup = async () => {
    setSetupStatus("running");
    setSettingsOpen(false);
    try {
      const res = await fetch("/api/setup", { method: "POST" });
      const json = await res.json();
      setSetupStatus(json.error ? "error" : "done");
      if (!json.error) fetchDocuments(); // Refresh sidebar on success.
    } catch {
      setSetupStatus("error");
    }
    // Reset the button label after 5 seconds so the user can run setup again.
    setTimeout(() => setSetupStatus("idle"), 5000);
  };

  // ── File upload ────────────────────────────────────────────────────────────

  /**
   * Uploads one or more files to /api/upload via FormData.
   * Shows a brief success/error toast and refreshes the document tree on
   * success.
   */
  const uploadFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    if (!fileArr.length) return;

    setUploading(true);
    setUploadToast(null);

    try {
      const form = new FormData();
      fileArr.forEach((f) => form.append("files", f));

      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();

      const ok = !json.error;
      setUploadToast({ msg: json.message ?? json.error, ok });
      if (ok) fetchDocuments(); // Refresh sidebar after a successful upload.
    } catch {
      setUploadToast({ msg: "Upload failed.", ok: false });
    } finally {
      setUploading(false);
      setTimeout(() => setUploadToast(null), 4000); // Auto-dismiss toast.
    }
  };

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────

  /** Handles files dropped onto the window. */
  const onDropZone = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  };

  /** Sets the dragging overlay visible while the user drags a file over the window. */
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  /** Hides the drag overlay only when the pointer truly leaves the drop zone
   *  (not when moving between child elements). */
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Global scoped styles ── */}
      <style>{`
        :root {
          --bg:           #0B0B0B;
          --sidebar-bg:   #111111;
          --surface:      #181818;
          --surface-hover:#1F1F1F;
          --border:       #242424;
          --border-light: #2C2C2C;
          --accent:       #C9A96E;
          --accent-subtle:#C9A96E1A;
          --user-bubble:  #1D1D1D;
          --ai-bubble:    #131313;
          --text-primary: #E8E2D9;
          --text-secondary:#A09890;
          --text-muted:   #5C5650;
          --danger:       #E07070;
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: var(--bg);
          color: var(--text-primary);
          font-family: var(--font-dm-sans), 'DM Sans', sans-serif;
          height: 100dvh;
          overflow: hidden;
        }

        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 99px; }

        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1; }
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .chat-item { position: relative; }
        .chat-item:hover .delete-btn { opacity: 1; }
        .delete-btn { opacity: 0; transition: opacity 0.15s; }

        .send-btn:hover { background: var(--accent) !important; color: #000 !important; }
        .send-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        textarea::placeholder { color: var(--text-muted); }
        textarea { resize: none; }
        textarea:focus { outline: none; }
      `}</style>

      {/* Hidden file input — triggered by the upload button or drag-and-drop */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.txt,.md"
        style={{ display: "none" }}
        onChange={(e) => e.target.files && uploadFiles(e.target.files)}
      />

      {/* Upload result toast — auto-dismissed after 4 seconds */}
      {uploadToast && (
        <div style={{
          position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "10px 20px", borderRadius: "10px",
          background: uploadToast.ok ? "var(--accent-subtle)" : "#2A1515",
          border: `1px solid ${uploadToast.ok ? "var(--accent)" : "var(--danger)"}`,
          color: uploadToast.ok ? "var(--accent)" : "var(--danger)",
          fontSize: "13px", fontFamily: "var(--font-dm-sans), sans-serif",
          animation: "fadeSlideIn 0.2s ease", whiteSpace: "nowrap",
          pointerEvents: "none",
        }}>
          {uploadToast.ok ? "✓ " : "✕ "}{uploadToast.msg}
        </div>
      )}

      {/* ── Root flex container — fills the viewport ── */}
      <div
        onDrop={onDropZone}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        style={{
          display: "flex",
          height: "100dvh",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Drag-and-drop overlay — shown while the user is dragging files */}
        {dragging && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 9000,
            background: "rgba(11,11,11,0.85)",
            backdropFilter: "blur(6px)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: "12px",
            border: "2px dashed var(--accent)",
            borderRadius: "0",
            pointerEvents: "none",
          }}>
            <div style={{
              width: "60px", height: "60px", borderRadius: "50%",
              background: "var(--accent-subtle)", border: "1.5px solid var(--accent)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px",
            }}>↑</div>
            <p style={{
              fontFamily: "var(--font-syne), sans-serif", fontWeight: 700,
              fontSize: "20px", color: "var(--text-primary)", letterSpacing: "-0.01em",
            }}>Drop files to upload</p>
            <p style={{
              fontFamily: "var(--font-dm-sans), sans-serif",
              fontSize: "13px", color: "var(--text-muted)",
            }}>.pdf · .txt · .md · max 20 MB each</p>
          </div>
        )}

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside
          style={{
            width: sidebarOpen ? "260px" : "0",
            minWidth: sidebarOpen ? "260px" : "0",
            overflow: "hidden",
            transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
            background: "var(--sidebar-bg)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              padding: "0",
              minWidth: "260px",
            }}
          >
            {/* ── Logo + New Chat button ── */}
            <div
              style={{
                padding: "20px 16px 12px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "8px",
                    background: "var(--accent-subtle)",
                    border: "1.5px solid var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                  }}
                >
                  ✦
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-syne), sans-serif",
                    fontWeight: 700,
                    fontSize: "15px",
                    letterSpacing: "-0.01em",
                    color: "var(--text-primary)",
                  }}
                >
                  DocSearch AI
                </span>
              </div>

              {/* New Chat button — creates a blank chat and focuses the input */}
              <button
                onClick={createNewChat}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  background: "var(--surface)",
                  border: "1px solid var(--border-light)",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  fontSize: "13px",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-light)";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                <span style={{ fontSize: "16px", lineHeight: 1 }}>+</span>
                New chat
              </button>
            </div>

            {/* ── Document tree section ── */}
            <div
              style={{
                borderBottom: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              {/* Collapsible header — toggles the document tree */}
              <button
                onClick={() => setDocsExpanded((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "12px 16px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: "11px",
                  fontFamily: "var(--font-syne), sans-serif",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--text-secondary)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--text-muted)")
                }
              >
                <span>Documents</span>
                <span style={{ fontSize: "10px" }}>
                  {docsExpanded ? "▾" : "▸"}
                </span>
              </button>

              {/* Document tree — shown when expanded */}
              {docsExpanded && (
                <div
                  style={{
                    maxHeight: "240px",
                    overflowY: "auto",
                    padding: "4px 8px 12px",
                  }}
                >
                  {/* Active filter pill — click to clear the document filter */}
                  {selectedDoc && (
                    <button
                      onClick={() => setSelectedDoc("")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        width: "100%",
                        padding: "5px 8px",
                        marginBottom: "4px",
                        borderRadius: "6px",
                        background: "var(--accent-subtle)",
                        border: "1px solid var(--accent)",
                        cursor: "pointer",
                        color: "var(--accent)",
                        fontSize: "11px",
                        fontFamily: "var(--font-syne), sans-serif",
                        fontWeight: 600,
                      }}
                    >
                      <span>✕</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {selectedDoc}
                      </span>
                    </button>
                  )}

                  {/* Empty state / file tree */}
                  {documents.length === 0 ? (
                    <p
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "12px",
                        padding: "4px 8px",
                        fontFamily: "var(--font-dm-sans), sans-serif",
                      }}
                    >
                      No documents found.
                      <br />
                      Run setup first.
                    </p>
                  ) : (
                    <DocTree
                      nodes={documents}
                      selectedPath={selectedDoc}
                      onSelect={setSelectedDoc}
                    />
                  )}
                </div>
              )}
            </div>

            {/* ── Chat history list ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "8px 8px",
              }}
            >
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "11px",
                  fontFamily: "var(--font-syne), sans-serif",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "6px 8px 4px",
                }}
              >
                History
              </p>

              {chats.length === 0 ? (
                <p
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "12px",
                    padding: "6px 8px",
                    fontFamily: "var(--font-dm-sans), sans-serif",
                  }}
                >
                  No conversations yet.
                </p>
              ) : (
                chats.map((chat) => (
                  <div
                    key={chat.id}
                    className="chat-item"
                    onClick={() => setCurrentChatId(chat.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "7px 8px",
                      borderRadius: "7px",
                      cursor: "pointer",
                      background:
                        currentChatId === chat.id
                          ? "var(--surface)"
                          : "transparent",
                      border:
                        currentChatId === chat.id
                          ? "1px solid var(--border-light)"
                          : "1px solid transparent",
                      marginBottom: "2px",
                      transition: "all 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (currentChatId !== chat.id)
                        e.currentTarget.style.background = "var(--surface-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (currentChatId !== chat.id)
                        e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {/* Chat title — truncated with ellipsis */}
                    <span
                      style={{
                        flex: 1,
                        fontSize: "12.5px",
                        color:
                          currentChatId === chat.id
                            ? "var(--text-primary)"
                            : "var(--text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-dm-sans), sans-serif",
                      }}
                    >
                      {chat.title}
                    </span>

                    {/* Delete button — visible on hover via CSS */}
                    <button
                      className="delete-btn"
                      onClick={(e) => deleteChat(chat.id, e)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text-muted)",
                        fontSize: "13px",
                        padding: "0 2px",
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.color = "var(--danger)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.color = "var(--text-muted)")
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* ── Settings / Setup section ── */}
            <div
              style={{
                padding: "12px 8px",
                borderTop: "1px solid var(--border)",
              }}
            >
              {/* Settings toggle button */}
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "7px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: "12.5px",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--text-secondary)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--text-muted)")
                }
              >
                ⚙ Settings
              </button>

              {/* Build / Rebuild Index button — shown when settings are expanded */}
              {settingsOpen && (
                <div
                  style={{
                    padding: "8px 4px 2px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <button
                    onClick={runSetup}
                    disabled={setupStatus === "running"}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "7px",
                      background:
                        setupStatus === "done"
                          ? "var(--accent-subtle)"
                          : "var(--surface)",
                      border: `1px solid ${
                        setupStatus === "done"
                          ? "var(--accent)"
                          : setupStatus === "error"
                          ? "var(--danger)"
                          : "var(--border-light)"
                      }`,
                      cursor: setupStatus === "running" ? "not-allowed" : "pointer",
                      color:
                        setupStatus === "done"
                          ? "var(--accent)"
                          : setupStatus === "error"
                          ? "var(--danger)"
                          : "var(--text-secondary)",
                      fontSize: "12px",
                      fontFamily: "var(--font-dm-sans), sans-serif",
                      textAlign: "left",
                    }}
                  >
                    {setupStatus === "running"
                      ? "⏳ Building index..."
                      : setupStatus === "done"
                      ? "✓ Index built!"
                      : setupStatus === "error"
                      ? "✕ Setup failed"
                      : "↑ Build / Rebuild Index"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── Main content area ────────────────────────────────────────────── */}
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            height: "100dvh",
            overflow: "hidden",
            background: "var(--bg)",
          }}
        >
          {/* ── Top bar: sidebar toggle + active doc pill + chat title ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              gap: "10px",
              flexShrink: 0,
            }}
          >
            {/* Sidebar toggle (hamburger) */}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                fontSize: "18px",
                lineHeight: 1,
                padding: "2px 6px",
                borderRadius: "5px",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--text-secondary)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--text-muted)")
              }
              title="Toggle sidebar"
            >
              ☰
            </button>

            {/* Active document filter pill — click ✕ to clear */}
            {selectedDoc && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "3px 10px",
                  borderRadius: "99px",
                  background: "var(--accent-subtle)",
                  border: "1px solid var(--accent)",
                  fontSize: "12px",
                  color: "var(--accent)",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  maxWidth: "300px",
                  overflow: "hidden",
                }}
              >
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {getFileIcon(selectedDoc)} {selectedDoc}
                </span>
                <button
                  onClick={() => setSelectedDoc("")}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--accent)",
                    fontSize: "11px",
                    lineHeight: 1,
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Active chat title — shown on the right */}
            {currentChat && (
              <span
                style={{
                  fontSize: "13px",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  marginLeft: "auto",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "260px",
                }}
              >
                {currentChat.title}
              </span>
            )}
          </div>

          {/* ── Message area ── */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "32px 0",
            }}
          >
            <div style={{ maxWidth: "720px", margin: "0 auto", padding: "0 24px" }}>

              {/* Empty state or message list */}
              {!currentChat || currentChat.messages.length === 0 ? (
                /* Empty state — shown when no chat is active or it has no messages */
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "50vh",
                    gap: "16px",
                    textAlign: "center",
                    animation: "fadeSlideIn 0.4s ease",
                  }}
                >
                  <div
                    style={{
                      width: "52px",
                      height: "52px",
                      borderRadius: "16px",
                      background: "var(--accent-subtle)",
                      border: "1.5px solid var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "22px",
                    }}
                  >
                    ✦
                  </div>
                  <h1
                    style={{
                      fontFamily: "var(--font-syne), sans-serif",
                      fontWeight: 700,
                      fontSize: "24px",
                      color: "var(--text-primary)",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    Ask your documents
                  </h1>
                  <p
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "14px",
                      maxWidth: "360px",
                      lineHeight: 1.6,
                      fontFamily: "var(--font-dm-sans), sans-serif",
                    }}
                  >
                    Select a document from the sidebar or ask a question to
                    search across all indexed files.
                  </p>

                  {/* Suggested prompt chips */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      justifyContent: "center",
                      marginTop: "8px",
                    }}
                  >
                    {[
                      "What is this document about?",
                      "Summarize the key points",
                      "What are the main conclusions?",
                    ].map((hint) => (
                      <button
                        key={hint}
                        onClick={() => {
                          setQuery(hint);
                          textareaRef.current?.focus();
                        }}
                        style={{
                          padding: "7px 14px",
                          borderRadius: "99px",
                          background: "var(--surface)",
                          border: "1px solid var(--border-light)",
                          cursor: "pointer",
                          color: "var(--text-secondary)",
                          fontSize: "12.5px",
                          fontFamily: "var(--font-dm-sans), sans-serif",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--accent)";
                          e.currentTarget.style.color = "var(--text-primary)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border-light)";
                          e.currentTarget.style.color = "var(--text-secondary)";
                        }}
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* Render all message bubbles for the active chat */
                currentChat.messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))
              )}

              {/* Loading indicator — three pulsing dots while waiting for AI */}
              {loading && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    marginBottom: "20px",
                  }}
                >
                  <div
                    style={{
                      width: "30px",
                      height: "30px",
                      borderRadius: "50%",
                      background: "var(--accent-subtle)",
                      border: "1.5px solid var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "14px",
                      flexShrink: 0,
                      marginTop: "2px",
                    }}
                  >
                    ✦
                  </div>
                  <div
                    style={{
                      padding: "14px 18px",
                      borderRadius: "4px 18px 18px 18px",
                      background: "var(--ai-bubble)",
                      border: "1px solid var(--border)",
                      display: "flex",
                      gap: "5px",
                      alignItems: "center",
                    }}
                  >
                    {[0, 0.2, 0.4].map((delay) => (
                      <span
                        key={delay}
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "var(--accent)",
                          display: "inline-block",
                          animation: `pulse 1.2s ${delay}s ease-in-out infinite`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Invisible scroll anchor — scrollIntoView targets this */}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* ── Input area ── */}
          <div
            style={{
              padding: "16px 24px 20px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg)",
              flexShrink: 0,
            }}
          >
            <div style={{ maxWidth: "720px", margin: "0 auto" }}>
              {/* Input container — highlights accent border on focus */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "10px",
                  padding: "10px 14px 10px 12px",
                  borderRadius: "14px",
                  background: "var(--surface)",
                  border: "1px solid var(--border-light)",
                  transition: "border-color 0.2s",
                }}
                onFocusCapture={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.borderColor =
                    "var(--accent)")
                }
                onBlurCapture={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.borderColor =
                    "var(--border-light)")
                }
              >
                {/* Upload button — opens file picker; spins while uploading */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Upload documents (.pdf, .txt, .md)"
                  style={{
                    width: "32px", height: "32px", borderRadius: "8px",
                    background: "none", border: "1px solid var(--border-light)",
                    cursor: uploading ? "not-allowed" : "pointer",
                    color: uploading ? "var(--accent)" : "var(--text-muted)",
                    fontSize: uploading ? "11px" : "18px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, transition: "all 0.15s",
                    lineHeight: 1,
                    animation: uploading ? "spin 1s linear infinite" : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!uploading) {
                      e.currentTarget.style.borderColor = "var(--accent)";
                      e.currentTarget.style.color = "var(--accent)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!uploading) {
                      e.currentTarget.style.borderColor = "var(--border-light)";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }
                  }}
                >
                  {uploading ? "◌" : "+"}
                </button>

                {/* Auto-resizing textarea for user input */}
                <textarea
                  ref={textareaRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    selectedDoc
                      ? `Ask about ${selectedDoc}…`
                      : "Ask anything about your documents…"
                  }
                  rows={1}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    color: "var(--text-primary)",
                    fontSize: "14.5px",
                    fontFamily: "var(--font-dm-sans), sans-serif",
                    lineHeight: "1.6",
                    padding: "2px 0",
                    minHeight: "28px",
                    maxHeight: "180px",
                    overflowY: "auto",
                  }}
                />

                {/* Send button — highlights gold and turns black on hover */}
                <button
                  className="send-btn"
                  onClick={sendQuery}
                  disabled={!query.trim() || loading}
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "9px",
                    background: query.trim() && !loading
                      ? "var(--surface-hover)"
                      : "transparent",
                    border: "1px solid var(--border-light)",
                    cursor: "pointer",
                    color: query.trim() && !loading
                      ? "var(--text-primary)"
                      : "var(--text-muted)",
                    fontSize: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "all 0.15s",
                  }}
                  title="Send (Enter)"
                >
                  ↑
                </button>
              </div>

              {/* Keyboard shortcut hint */}
              <p
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "11px",
                  marginTop: "8px",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                }}
              >
                Enter to send · Shift+Enter for new line · + or drag &amp; drop to upload files
              </p>
            </div>
          </div>
        </main>
        {/*
         * FIX #1 — Removed the stray </div> that was here.
         * The root flex container opened on line ~522 is correctly closed
         * by the </div> immediately below; the extra one caused a JSX
         * parse error (one closing tag too many).
         */}
      </div>
    </>
  );
}