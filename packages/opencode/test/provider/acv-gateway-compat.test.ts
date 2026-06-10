import { describe, expect, it } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

describe("ACV gateway compat — caller:null stripping", () => {
  it("strips null caller from tool_use content block", () => {
    const input = {
      model: {
        // Fields required by the current dev-branch ProviderTransform.message()
        // (normalizeMessages reads model.api.id, model.id, model.capabilities).
        id: "anthropic/claude-opus",
        providerID: "anthropic",
        api: { npm: "@ai-sdk/anthropic", id: "anthropic/claude-opus" },
        capabilities: { interleaved: false, reasoning: false, toolCall: true, temperature: true },
      },
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_vrtx_01S4gT3F8WVVkfcPtRmaD1PK",
              name: "read",
              input: {},
              caller: null, // ACV gateway injects this — must be stripped
            },
          ],
        },
      ],
    }

    const result: any = ProviderTransform.message(
      input.messages as any,
      input.model as any,
      {}
    )

    const toolBlock = result
      .find((m: any) => m.role === "assistant")
      ?.content?.find((b: any) => b.type === "tool_use")

    expect(toolBlock).toBeDefined()
    expect("caller" in toolBlock).toBe(false)
    expect(toolBlock.id).toBe("toolu_vrtx_01S4gT3F8WVVkfcPtRmaD1PK")
    expect(toolBlock.name).toBe("read")
  })

  it("does not strip non-null fields from tool_use block", () => {
    const input = {
      model: {
        // Fields required by the current dev-branch ProviderTransform.message()
        // (normalizeMessages reads model.api.id, model.id, model.capabilities).
        id: "anthropic/claude-opus",
        providerID: "anthropic",
        api: { npm: "@ai-sdk/anthropic", id: "anthropic/claude-opus" },
        capabilities: { interleaved: false, reasoning: false, toolCall: true, temperature: true },
      },
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_123",
              name: "write",
              input: { path: "/tmp/foo.txt", content: "hello" },
              caller: null,
            },
          ],
        },
      ],
    }

    const result: any = ProviderTransform.message(
      input.messages as any,
      input.model as any,
      {}
    )

    const toolBlock = result
      .find((m: any) => m.role === "assistant")
      ?.content?.find((b: any) => b.type === "tool_use")

    expect(toolBlock.input).toEqual({ path: "/tmp/foo.txt", content: "hello" })
    expect(toolBlock.id).toBe("toolu_123")
    expect(toolBlock.name).toBe("write")
    expect("caller" in toolBlock).toBe(false)
  })

  it("leaves non-tool_use content blocks untouched", () => {
    const input = {
      model: {
        // Fields required by the current dev-branch ProviderTransform.message()
        // (normalizeMessages reads model.api.id, model.id, model.capabilities).
        id: "anthropic/claude-opus",
        providerID: "anthropic",
        api: { npm: "@ai-sdk/anthropic", id: "anthropic/claude-opus" },
        capabilities: { interleaved: false, reasoning: false, toolCall: true, temperature: true },
      },
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Here is the result.",
            },
          ],
        },
      ],
    }

    const result: any = ProviderTransform.message(
      input.messages as any,
      input.model as any,
      {}
    )

    const textBlock = result
      .find((m: any) => m.role === "assistant")
      ?.content?.find((b: any) => b.type === "text")

    expect(textBlock?.text).toBe("Here is the result.")
  })
})
