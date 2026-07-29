import * as github from "@actions/github";

export interface EventContext {
  eventName: string;
  prAction: string | undefined;
  prNumber: number | undefined;
  prTitle: string | undefined;
}

export function getContext(): EventContext {
  return {
    eventName: github.context.eventName,
    prAction: github.context.payload.action,
    prNumber: github.context.payload.number,
    prTitle: github.context.payload.pull_request?.title,
  };
}
