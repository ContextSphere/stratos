import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QuestionSequence } from "../components/QuestionSequence";
import type { AskUserQuestionRequest } from "../types";

describe("QuestionSequence", () => {
  afterEach(() => cleanup());

  it("does not crash when questionData.input is undefined", () => {
    // Regression test: stored messages may have questionData with missing input field
    const malformed = {
      requestId: "req_1",
    } as unknown as AskUserQuestionRequest;
    expect(() =>
      render(
        <QuestionSequence questionData={malformed} onComplete={vi.fn()} />,
      ),
    ).not.toThrow();
  });

  it("does not crash when questionData.input.questions is missing", () => {
    const malformed = {
      requestId: "req_2",
      input: {},
    } as unknown as AskUserQuestionRequest;
    expect(() =>
      render(
        <QuestionSequence questionData={malformed} onComplete={vi.fn()} />,
      ),
    ).not.toThrow();
  });

  it("renders questions when input is valid", () => {
    const data: AskUserQuestionRequest = {
      requestId: "req_3",
      input: {
        questions: [
          {
            question: "Pick one",
            options: [{ label: "A" }, { label: "B" }],
            multiSelect: false,
          },
        ],
      },
    };
    const { getByText } = render(
      <QuestionSequence questionData={data} onComplete={vi.fn()} />,
    );
    expect(getByText("Pick one")).toBeInTheDocument();
  });
});
