import React, { useState, useCallback } from "react";
import { QuestionBlock } from "./QuestionBlock";
import type { AskUserQuestionRequest } from "../types";

interface QuestionSequenceProps {
  questionData: AskUserQuestionRequest;
  onComplete: (requestId: string, answers: Record<string, string>) => void;
  disabled?: boolean;
  initiallyAnswered?: boolean;
}

export function QuestionSequence({
  questionData,
  onComplete,
  disabled,
  initiallyAnswered,
}: QuestionSequenceProps): React.ReactElement {
  const questions = questionData.input.questions;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState(!!initiallyAnswered);

  const handleSubmit = useCallback(
    (answer: string) => {
      const q = questions[currentIndex];
      const nextAnswers = { ...answers, [q.question]: answer };
      setAnswers(nextAnswers);

      if (currentIndex + 1 < questions.length) {
        setCurrentIndex(currentIndex + 1);
      } else {
        setCompleted(true);
        onComplete(questionData.requestId, nextAnswers);
      }
    },
    [currentIndex, answers, questions, questionData.requestId, onComplete],
  );

  const showProgress = questions.length > 1;

  return (
    <div className="mt-3 space-y-2">
      {/* Previously answered questions */}
      {questions.slice(0, currentIndex).map((q, i) => (
        <div
          key={i}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-overlay)]/60 px-3 py-2 opacity-60"
        >
          <p className="text-xs text-gray-400">{q.question}</p>
          <p className="text-xs text-blue-400 mt-0.5">{answers[q.question]}</p>
        </div>
      ))}

      {/* Completed state: show all answers */}
      {completed &&
        questions.slice(currentIndex).map((q, i) => (
          <div
            key={currentIndex + i}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-overlay)]/60 px-3 py-2 opacity-60"
          >
            <p className="text-xs text-gray-400">{q.question}</p>
            <p className="text-xs text-blue-400 mt-0.5">
              {answers[q.question]}
            </p>
          </div>
        ))}

      {/* Active question */}
      {!completed && (
        <>
          {showProgress && (
            <p className="text-xs text-gray-500 px-1">
              Question {currentIndex + 1} of {questions.length}
            </p>
          )}
          <QuestionBlock
            key={currentIndex}
            data={questions[currentIndex]}
            onSubmit={handleSubmit}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}
