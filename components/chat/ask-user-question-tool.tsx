"use client";

import { useState } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Tool, ToolContent, ToolHeader } from "../ai-elements/tool";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { getAskUserQuestionCardState } from "./ask-user-question-state";

type AskUserQuestionPart = Extract<
  ChatMessage["parts"][number],
  { type: "tool-askUserQuestion" }
>;

type AskUserQuestionOption = {
  label: string;
  value?: string;
  description?: string;
};

export function AskUserQuestionTool({
  message,
  part,
  isReadonly,
}: {
  message: ChatMessage;
  part: AskUserQuestionPart;
  isReadonly: boolean;
}) {
  const { addToolOutput, messages, status } = useActiveChat();
  const [isOtherOpen, setIsOtherOpen] = useState(false);
  const [otherAnswer, setOtherAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { answer, answerLabel, isPending } = getAskUserQuestionCardState(
    messages,
    message.id,
    part.toolCallId
  );

  const isAnswered = Boolean(answer);
  const isInteractive =
    !isReadonly && isPending && status === "ready" && !isSubmitting;
  const headerState = isAnswered ? "output-available" : part.state;
  const questionInput = part.input;
  const options = (questionInput?.options ?? []) as AskUserQuestionOption[];

  if (!questionInput) {
    return null;
  }

  const submitAnswer = async ({
    answer,
    label,
    source,
  }: {
    answer: string;
    label: string;
    source: "option" | "other";
  }) => {
    const trimmedAnswer = answer.trim();
    const trimmedLabel = label.trim();

    if (!trimmedAnswer || !trimmedLabel || !isInteractive) {
      return;
    }

    setIsSubmitting(true);

    try {
      await addToolOutput({
        output: {
          answer: trimmedAnswer,
          label: trimmedLabel,
          source,
        },
        tool: "askUserQuestion",
        toolCallId: part.toolCallId,
      });
      setOtherAnswer("");
      setIsOtherOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Tool className="w-[min(100%,450px)]" defaultOpen={true}>
      <ToolHeader title="Question" state={headerState} type="tool-askUserQuestion" />
      <ToolContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant={isAnswered ? "secondary" : "outline"}>
                {isAnswered ? "Answered" : "Awaiting response"}
              </Badge>
            </div>

            <div className="space-y-1">
              <p className="font-medium text-sm">{questionInput.question}</p>
              <p className="text-muted-foreground text-xs">
                Choose one option or use Other to enter a custom response.
              </p>
            </div>
          </div>

          {isAnswered ? (
            <div className="rounded-2xl border border-border/50 bg-muted/30 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Answer
              </p>
              <p className="mt-1 text-sm">Answer: {answerLabel}</p>
            </div>
          ) : isOtherOpen ? (
            <div className="space-y-3">
              <Input
                data-testid="ask-user-question-other-input"
                disabled={!isInteractive}
                onChange={(event) => setOtherAnswer(event.target.value)}
                placeholder={questionInput.placeholder ?? "Type your answer"}
                value={otherAnswer}
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  data-testid="ask-user-question-other-submit"
                  disabled={!isInteractive || otherAnswer.trim().length === 0}
                  onClick={() =>
                    submitAnswer({
                      answer: otherAnswer,
                      label: otherAnswer,
                      source: "other",
                    })
                  }
                  size="sm"
                  type="button"
                >
                  Submit
                </Button>
                <Button
                  disabled={isSubmitting}
                  onClick={() => {
                    setIsOtherOpen(false);
                    setOtherAnswer("");
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {options.map((option, index) => (
                <button
                  className={cn(
                    "w-full rounded-2xl border border-border/50 bg-card/40 px-3 py-3 text-left transition-colors",
                    isInteractive
                      ? "hover:border-border hover:bg-card/70"
                      : "cursor-not-allowed opacity-60"
                  )}
                  disabled={!isInteractive}
                  key={`${option.value ?? option.label}-${index}`}
                  onClick={() =>
                    submitAnswer({
                      answer: option.value ?? option.label,
                      label: option.label,
                      source: "option",
                    })
                  }
                  type="button"
                >
                  <span className="block font-medium text-sm">{option.label}</span>
                  {option.description ? (
                    <span className="mt-1 block text-muted-foreground text-xs">
                      {option.description}
                    </span>
                  ) : null}
                </button>
              ))}

              <Button
                data-testid="ask-user-question-other-button"
                disabled={!isInteractive}
                onClick={() => setIsOtherOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                Other
              </Button>
            </div>
          )}
        </div>
      </ToolContent>
    </Tool>
  );
}
