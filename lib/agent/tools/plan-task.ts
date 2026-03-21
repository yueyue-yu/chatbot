import { tool } from "ai";
import { z } from "zod";

export type PlanTaskResult = {
  goal: string;
  summary: string;
  steps: string[];
  firstAction: string;
};

function normalizeGoal(goal: string) {
  return goal.replace(/\s+/g, " ").trim();
}

function splitGoalIntoActions(goal: string) {
  return goal
    .split(/\b(?:and then|then|after that|next)\b|[.;]/i)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function toSentence(text: string) {
  const trimmed = text.trim().replace(/[.:]\s*$/, "");

  if (!trimmed) {
    return "";
  }

  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function buildPlan(goal: string): PlanTaskResult {
  const normalizedGoal = normalizeGoal(goal);
  const directActions = splitGoalIntoActions(normalizedGoal).map((segment) =>
    toSentence(segment)
  );

  const steps = [
    directActions[0]
      ? `Clarify the outcome and success criteria for "${directActions[0]}".`
      : `Clarify the desired outcome and success criteria for "${normalizedGoal}".`,
    directActions[1]
      ? `Prepare the inputs, context, or dependencies needed to tackle "${directActions[1]}".`
      : "Gather the minimum inputs, context, and dependencies needed to begin.",
    directActions[2]
      ? `Execute the smallest useful version of "${directActions[2]}", then review the result.`
      : "Execute the smallest useful milestone, review the result, and decide the next iteration.",
  ];

  return {
    goal: normalizedGoal,
    summary:
      directActions.length > 1
        ? `Turn the goal into ${steps.length} ordered actions so the work can start immediately.`
        : "Turn the goal into a short, concrete plan with a clear first move.",
    steps,
    firstAction: steps[0],
  };
}

export function createPlanTaskTool() {
  return tool({
    description:
      "Break the latest user goal into a short execution plan with a clear first action.",
    inputSchema: z.object({
      goal: z.string().min(1).describe("The user's requested goal or task."),
    }),
    execute: async ({ goal }) => buildPlan(goal),
  });
}
