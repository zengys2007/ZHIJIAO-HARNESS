import { useEffect, useRef, useState, type FormEvent } from "react";
import { knowledgeApi as defaultApi } from "../api/http";
import type { KnowledgeApi, KnowledgeDocument, KnowledgeStatus } from "../types/api";

type Props = {
  /** 测试注入：默认走后端。页面只调用这个接口，不访问嵌入服务。 */
  api?: KnowledgeApi;
};

const NO_TEXT_MESSAGE = "这个文件里没有抽出文字";
const POLL_MS = 2000;

const STATUS_LABEL: Record<KnowledgeStatus, string> = {
  pending: "处理中",
  ready: "已就绪",
  failed: "失败",
};

export function KnowledgePanel({ api = defaultApi }: Props) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelDraft, setModelDraft] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void api
      .listDocuments()
      .then((result) => {
        if (!alive) return;
        setEmbeddingModel(result.embedding_model);
        setDocuments(result.documents);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setLoadError(error instanceof Error ? error.message : "读取知识库失败，请稍后再试。");
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    if (!documents.some((item) => item.status === "pending")) return;
    let alive = true;
    const timer = window.setInterval(() => {
      void api
        .listDocuments()
        .then((result) => {
          if (!alive) return;
          setEmbeddingModel(result.embedding_model);
          setDocuments(result.documents);
        })
        .catch(() => {
          // 下一次间隔再拉。离开页面时定时器会清掉。
        });
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [api, documents]);

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请稍后再试。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function saveModel(event: FormEvent) {
    event.preventDefault();
    const model = modelDraft.trim();
    void run(async () => {
      const saved = await api.saveEmbeddingModel(model);
      setEmbeddingModel(saved.embedding_model);
      setModelDraft(saved.embedding_model);
      const listed = await api.listDocuments();
      setEmbeddingModel(listed.embedding_model);
      setDocuments(listed.documents);
    });
  }

  function submitPaste(event: FormEvent) {
    event.preventDefault();
    const title = pasteTitle.trim();
    const content = pasteContent.trim();
    if (!title || !content) {
      setNotice("标题和正文都不能为空。");
      return;
    }
    void run(async () => {
      const created = await api.createPaste(title, content);
      setDocuments((current) => [created, ...current.filter((item) => item.document_id !== created.document_id)]);
      setPasteTitle("");
      setPasteContent("");
    });
  }

  function submitUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const chosen = file;
    const title = uploadTitle.trim();
    void run(async () => {
      const created = await api.createUpload(chosen, title || undefined);
      setDocuments((current) => [created, ...current.filter((item) => item.document_id !== created.document_id)]);
      setUploadTitle("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function retry(doc: KnowledgeDocument) {
    void run(async () => {
      const next = await api.embedDocument(doc.document_id);
      setDocuments((current) => current.map((item) => (item.document_id === next.document_id ? next : item)));
    });
  }

  function remove(doc: KnowledgeDocument) {
    if (!window.confirm(`删除「${doc.title}」？`)) return;
    void run(async () => {
      await api.deleteDocument(doc.document_id);
      setDocuments((current) => current.filter((item) => item.document_id !== doc.document_id));
    });
  }

  return (
    <div className="teaching">
      <header className="teaching-header">
        <div>
          <h1>知识库</h1>
          <p className="teaching-lead">粘贴文字，或上传 txt、markdown、PDF、Word。提问时会从这些资料里检索。</p>
        </div>
      </header>

      {loaded && embeddingModel === "" ? (
        <form className="teaching-form" onSubmit={saveModel}>
          <p className="teaching-notice" role="status">
            尚未配置嵌入模型，检索暂停
          </p>
          <label className="teaching-field">
            <span>嵌入模型</span>
            <input
              value={modelDraft}
              onChange={(event) => setModelDraft(event.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <button type="submit" className="teaching-submit" disabled={busy}>
            保存
          </button>
        </form>
      ) : null}

      <div className="teaching-body">
        <form className="teaching-form" onSubmit={submitPaste}>
          <h2>粘贴文字</h2>
          <label className="teaching-field">
            <span>标题</span>
            <input value={pasteTitle} onChange={(event) => setPasteTitle(event.target.value)} disabled={busy} />
          </label>
          <label className="teaching-field">
            <span>正文</span>
            <textarea value={pasteContent} onChange={(event) => setPasteContent(event.target.value)} disabled={busy} />
          </label>
          <button type="submit" className="teaching-submit" disabled={busy}>
            粘贴
          </button>
        </form>

        <form className="teaching-form" onSubmit={submitUpload}>
          <h2>上传文件</h2>
          <label className="teaching-field">
            <span>标题（可空）</span>
            <input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} disabled={busy} />
          </label>
          <label className="teaching-field">
            <span>文件</span>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf,.docx"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button type="submit" className="teaching-submit" disabled={busy || file === null}>
            上传
          </button>
        </form>
      </div>

      {notice ? (
        <p className="teaching-notice" role="alert">
          {notice}
        </p>
      ) : null}

      {!loaded ? (
        <p className="teaching-loading" role="status">
          正在读取资料…
        </p>
      ) : loadError ? (
        <p role="alert">{loadError}</p>
      ) : documents.length === 0 ? (
        <p className="teaching-empty">还没有资料。</p>
      ) : (
        <section className="teaching-list">
          <h2>已有资料</h2>
          {documents.map((doc) => (
            <article key={doc.document_id} className="teaching-item">
              <div className="teaching-item-head">
                <strong>{doc.title}</strong>
                <span className="teaching-meta">{STATUS_LABEL[doc.status]}</span>
              </div>
              {doc.filename ? <p className="teaching-item-body">{doc.filename}</p> : null}
              {doc.message ? <p className="teaching-item-body">{doc.message}</p> : null}
              <div className="teaching-item-head">
                {showRetry(doc) ? (
                  <button type="button" className="teaching-seed" onClick={() => retry(doc)}>
                    重试
                  </button>
                ) : null}
                <button type="button" className="teaching-seed" onClick={() => remove(doc)}>
                  删除
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function showRetry(doc: KnowledgeDocument): boolean {
  if (doc.status !== "failed") return false;
  if ((doc.extension !== "" || doc.source === "paste") && doc.message === NO_TEXT_MESSAGE) return false;
  return true;
}
