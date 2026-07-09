/**
 * Deep-scan #22 Track D — n8n drift detector coverage for:
 *   D1: retired Ollama model references (tower serves ONLY `gemma4:e4b-it-qat`).
 *   D2: broadened leaked-key regex catches modern OpenAI key formats.
 *
 * D1: `audit-n8n-workflows.mjs` had 9 checks, none of which inspected ollama
 * `model` fields — so a workflow node still pointing at a RETIRED model reported
 * "0 violations". `findRetiredModelRefs` now surfaces every such node.
 *
 * D2: the legacy `/sk-[a-zA-Z0-9]{20,}/` API-key pattern stopped at the first
 * hyphen and missed `sk-proj-...` / `sk-svcacct-...` (the 2024+ default formats).
 */
import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — .mjs audit script, no type decls; exported for test coverage.
import { findRetiredModelRefs, findApiKeys } from "../../../scripts/audit-n8n-workflows.mjs";

describe("D1 — n8n drift detector flags retired Ollama model references", () => {
  it("flags a node referencing a retired model in its ollama `model` field", () => {
    const v = findRetiredModelRefs({
      nodes: [
        { name: "Ollama Chat", type: "@n8n/n8n-nodes-langchain.lmChatOllama", parameters: { model: "deepseek-r1:14b" } },
      ],
    });
    expect(v).toHaveLength(1);
    expect(v[0].nodeName).toBe("Ollama Chat");
    expect(v[0].model).toBe("deepseek-r1");
  });

  it("flags all five retired models (deepseek-r1 / nomic-embed-text / qwen2.5-coder / phi4-mini / gemma4:e2b)", () => {
    const v = findRetiredModelRefs({
      nodes: [
        { name: "n1", parameters: { model: "deepseek-r1:14b" } },
        { name: "n2", parameters: { model: "nomic-embed-text" } },
        { name: "n3", parameters: { model: "qwen2.5-coder:7b" } },
        { name: "n4", parameters: { model: "phi4-mini" } },
        { name: "n5", parameters: { model: "gemma4:e2b" } },
      ],
    });
    expect(v.map((x: { model: string }) => x.model).sort()).toEqual(
      ["deepseek-r1", "gemma4:e2b", "nomic-embed-text", "phi4-mini", "qwen2.5-coder"],
    );
  });

  it("does NOT flag the one served model gemma4:e4b-it-qat (no e2b false-positive)", () => {
    const v = findRetiredModelRefs({
      nodes: [
        { name: "Served", type: "@n8n/n8n-nodes-langchain.lmChatOllama", parameters: { model: "gemma4:e4b-it-qat" } },
      ],
    });
    expect(v).toHaveLength(0);
  });

  it("tolerates a node with no model field / empty fleet without throwing", () => {
    expect(findRetiredModelRefs({ nodes: [{ name: "no-model", parameters: {} }] })).toEqual([]);
    expect(findRetiredModelRefs({ nodes: [] })).toEqual([]);
    expect(findRetiredModelRefs({})).toEqual([]);
  });
});

describe("D2 — leaked-key regex catches modern OpenAI key formats", () => {
  it("catches a project-scoped sk-proj-<...> key", () => {
    const v = findApiKeys({
      nodes: [
        { name: "HTTP Request", parameters: { headerAuth: "Bearer sk-proj-AbC123def456GHI789jkl012MNO345pqr678" } },
      ],
    });
    const openai = v.filter((x: { key: string }) => x.key === "openai");
    expect(openai.length).toBeGreaterThanOrEqual(1);
    expect(openai[0].nodeName).toBe("HTTP Request");
  });

  it("catches a service-account-scoped sk-svcacct-<...> key", () => {
    const v = findApiKeys({
      nodes: [
        { name: "Svc Node", parameters: { key: "sk-svcacct-ZyX987wvu654TSR321qpo098NML765kji432" } },
      ],
    });
    expect(v.some((x: { key: string }) => x.key === "openai")).toBe(true);
  });

  it("does NOT match an env-var reference {{ $env.OPENAI_API_KEY }}", () => {
    const v = findApiKeys({
      nodes: [{ name: "Env Ref", parameters: { key: "={{ $env.OPENAI_API_KEY }}" } }],
    });
    expect(v.some((x: { key: string }) => x.key === "openai")).toBe(false);
  });
});
