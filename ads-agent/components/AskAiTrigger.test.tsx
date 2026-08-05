// ads-agent/components/AskAiTrigger.test.tsx
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskAiTrigger } from "./AskAiTrigger";

describe("AskAiTrigger", () => {
  it("renders a button with an accessible label naming the question", () => {
    const html = renderToStaticMarkup(createElement(AskAiTrigger, { question: "Explain why CPL rose on Whitefield", onAsk: () => {} }));
    expect(html).toContain("Explain why CPL rose on Whitefield");
    expect(html).toContain("<button");
  });

  it("calls onAsk with the question when clicked — verified via the onClick handler directly (no jsdom/RTL in this repo)", () => {
    const onAsk = vi.fn();
    // AskAiTrigger's implementation must expose a plain onClick={() => onAsk(question)} handler;
    // we invoke the component function directly and call the returned element's onClick prop,
    // matching this repo's existing "call the function, inspect the tree" test convention
    // (no @testing-library/react dependency — see this plan's Global Constraints).
    const element = AskAiTrigger({ question: "Why did this lead go cold?", onAsk }) as { props: { onClick: () => void } };
    element.props.onClick();
    expect(onAsk).toHaveBeenCalledWith("Why did this lead go cold?");
  });
});

