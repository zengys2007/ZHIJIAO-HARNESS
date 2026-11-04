import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, knowledgeApi as httpKnowledgeApi, loadLlmSources } from "../api/http";
import type { KnowledgeApi, KnowledgeDocument } from "../types/api";
import { KnowledgePanel } from "./KnowledgePanel";

const documentId = "0123456789abcdef0123456789abcdef";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("知识库页面", () => {
  it("列表为空时能看见空状态", async () => {
    render(<KnowledgePanel api={knowledgeApi()} />);

    expect(await screen.findByText("还没有资料。")).toBeTruthy();
  });

  it("失败的 pdf 能看见重试，点击后调用 embedDocument", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const failed = document({
      status: "failed",
      extension: ".pdf",
      source: "upload",
      filename: "分数教案.pdf",
      message: "嵌入服务暂时不可用，可以重试。",
    });
    render(
      <KnowledgePanel
        api={knowledgeApi({
          listDocuments: async () => ({ embedding_model: "embed-model", documents: [failed] }),
          embedDocument: async (id) => {
            calls.push(id);
            return failed;
          },
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "重试" }));
    await waitFor(() => expect(calls).toEqual([documentId]));
  });

  it("模型名为空时能看见输入框，保存调用 saveEmbeddingModel", async () => {
    const user = userEvent.setup();
    const saved: string[] = [];
    render(
      <KnowledgePanel
        api={knowledgeApi({
          listDocuments: async () => ({ embedding_model: "", documents: [] }),
          saveEmbeddingModel: async (model) => {
            saved.push(model);
            return { embedding_model: model };
          },
        })}
      />,
    );

    expect(await screen.findByText("尚未配置嵌入模型，检索暂停")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "嵌入模型" }), "text-embedding-3-small");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(saved).toEqual(["text-embedding-3-small"]));
  });

  it("抽不出文字时不显示重试", async () => {
    render(
      <KnowledgePanel
        api={knowledgeApi({
          listDocuments: async () => ({
            embedding_model: "embed-model",
            documents: [
              document({
                status: "failed",
                extension: ".pdf",
                message: "这个文件里没有抽出文字",
              }),
            ],
          }),
        })}
      />,
    );

    expect(await screen.findByText("分数教案")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("删除前先确认", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const deleted: string[] = [];
    render(
      <KnowledgePanel
        api={knowledgeApi({
          listDocuments: async () => ({
            embedding_model: "embed-model",
            documents: [document()],
          }),
          deleteDocument: async (id) => {
            deleted.push(id);
          },
        })}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "删除" }));
    expect(confirm).toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });
});

describe("知识库接口", () => {
  it("资料缺字段时抛 invalid_response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            embedding_model: "bge",
            documents: [{ document_id: "a".repeat(32), title: "只有标题" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await httpKnowledgeApi.listDocuments().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("invalid_response");
  });

  it("上传使用 FormData 的 file 字段", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(storedDocument()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["分数的意义"], "笔记.txt", { type: "text/plain" });

    await httpKnowledgeApi.createUpload(file, "笔记");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("file")).toBeInstanceOf(File);
    expect((form.get("file") as File).name).toBe("笔记.txt");
    expect(form.get("title")).toBe("笔记");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("旧的模型配置省略 embedding_model 时默认为空字符串", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            environment: { base_url: "http://env.test/v1", model: "chat", has_api_key: true, embedding_model: "bge" },
            dotenv: { base_url: "", model: "", has_api_key: false, embedding_model: "dotenv-embed" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            environment: { base_url: "http://env.test/v1", model: "chat", has_api_key: true },
            dotenv: { base_url: "", model: "", has_api_key: false },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const present = await loadLlmSources();
    expect(present.environment.embedding_model).toBe("bge");
    expect(present.dotenv.embedding_model).toBe("dotenv-embed");

    const missing = await loadLlmSources();
    expect(missing.environment.embedding_model).toBe("");
    expect(missing.dotenv.embedding_model).toBe("");
  });
});

function storedDocument(): KnowledgeDocument {
  return document({ source: "upload", filename: "笔记.txt", extension: ".txt", status: "pending" });
}

function document(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    document_id: documentId,
    title: "分数教案",
    source: "upload",
    filename: "分数教案.pdf",
    extension: ".pdf",
    status: "ready",
    message: "",
    created_at: "2026-11-04T01:00:00Z",
    ...overrides,
  };
}

function knowledgeApi(overrides: Partial<KnowledgeApi> = {}): KnowledgeApi {
  return {
    listDocuments: async () => ({ embedding_model: "embed-model", documents: [] }),
    createPaste: async () => {
      throw new Error("不应调用");
    },
    createUpload: async () => {
      throw new Error("不应调用");
    },
    deleteDocument: async () => {
      throw new Error("不应调用");
    },
    embedDocument: async () => {
      throw new Error("不应调用");
    },
    saveEmbeddingModel: async () => ({ embedding_model: "" }),
    ...overrides,
  };
}
