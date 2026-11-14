/** Follow-up questions about the current video, answered from its captions. */

import type { Panel } from "./ui/panel";
import { renderStreaming } from "./ui/renderer";
import { transcriptToText, type Transcript } from "./transcript";
import {
  askVideoQuestionStream,
  prepareQuestionContext,
  type QuestionContext,
} from "../service/ai-client";
import type { AISetupStatus } from "../service/ai-setup";
import { t, type OutputLanguage } from "../utils/i18n";
import type { Extractor } from "./content-types";

interface ChatTurn {
  question: string;
  answer: string;
  /** pending: preparing captions; streaming: answer arriving; stopped: aborted by the user. */
  state: "pending" | "streaming" | "done" | "error" | "stopped";
  error?: string;
}

export interface ChatHost {
  extractor: Extractor;
  getPanel(): Panel;
  currentPanel(): Panel | null;
  ensureTranscript(panel: Panel): Promise<Transcript>;
  getOutputLanguage(): OutputLanguage;
  getCustomInstruction(): string;
  getAISetupStatus(): AISetupStatus;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

export class ChatController {
  private turns: ChatTurn[] = [];
  private abortController: AbortController | null = null;
  /** Captions prepared for questions; long videos are condensed once per source/language. */
  private context: {
    transcript: Transcript;
    outputLanguage: OutputLanguage;
    value: Promise<QuestionContext>;
  } | null = null;
  private condensed = false;
  private streamingAnswerEl: HTMLElement | null = null;
  private renderFrameId: number | null = null;

  constructor(private readonly host: ChatHost) {}

  isRunning(): boolean {
    return this.abortController !== null;
  }

  /** "Ask" button. */
  open(): void {
    const panel = this.host.getPanel();
    const ai = this.host.getAISetupStatus();
    if (!ai.hasKey) panel.setAIAvailable(false, ai.providerName);
    panel.setTitle(this.host.extractor.getVideoTitle());
    panel.setMode("chat");
    panel.open();
    this.render(panel, true);
    panel.focusChatInput();
  }

  /** New video or output language: forget the conversation and prepared captions. */
  reset(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.turns = [];
    this.context = null;
    this.condensed = false;
    this.renderIfVisible();
  }

  /** "New chat": same video, empty conversation. */
  newChat(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.turns = [];
    this.renderIfVisible(true);
  }

  /** Panel closed or AI unavailable: stop the running answer, keep the conversation. */
  abort(): void {
    this.abortController?.abort();
  }

  /** Captions or model changed: prepare the captions again for the next question. */
  invalidateContext(): void {
    this.context = null;
  }

  refreshLocalizedText(): void {
    this.renderIfVisible();
  }

  async ask(question: string): Promise<void> {
    if (this.abortController) return;
    const panel = this.host.getPanel();
    const ai = this.host.getAISetupStatus();
    if (!ai.hasKey) {
      panel.setAIAvailable(false, ai.providerName);
      return;
    }
    const videoId = this.host.extractor.getVideoId();
    const outputLanguage = this.host.getOutputLanguage();
    const customInstruction = this.host.getCustomInstruction();
    const history = this.turns
      .filter((turn) => turn.state === "done")
      .map(({ question: previous, answer }) => ({ question: previous, answer }));
    const turn: ChatTurn = { question, answer: "", state: "pending" };
    this.turns.push(turn);
    const controller = new AbortController();
    this.abortController = controller;
    const assertCurrent = () => {
      if (
        controller.signal.aborted ||
        this.abortController !== controller ||
        this.host.extractor.getVideoId() !== videoId
      ) throw abortError();
    };
    panel.setChatBusy(true);
    this.render(panel, true);

    try {
      const transcript = await this.host.ensureTranscript(panel);
      assertCurrent();
      // Read after the caption load: the bridge reports the player's own title.
      const videoTitle = this.host.extractor.getKnownVideoTitle?.() ?? "";
      const context = await this.prepareContext(
        transcript, outputLanguage, customInstruction, videoTitle, controller.signal,
      );
      assertCurrent();
      turn.state = "streaming";
      this.renderIfVisible(true);
      for await (const token of askVideoQuestionStream({
        context,
        videoTitle,
        history,
        question,
        outputLanguage,
        customInstruction,
        signal: controller.signal,
      })) {
        assertCurrent();
        const firstToken = !turn.answer;
        turn.answer += token;
        // The first token replaces the "thinking" status; later ones only update the answer.
        if (firstToken) this.renderIfVisible();
        else this.scheduleAnswerRender(turn);
      }
      assertCurrent();
      turn.state = "done";
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        // reset()/newChat() already dropped the turn; a closed panel keeps it.
        if (this.turns.includes(turn)) turn.state = "stopped";
      } else {
        turn.state = "error";
        turn.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (this.renderFrameId !== null) cancelAnimationFrame(this.renderFrameId);
      this.renderFrameId = null;
      if (this.abortController === controller) this.abortController = null;
      panel.setChatBusy(false);
      this.renderIfVisible();
    }
  }

  private async prepareContext(
    transcript: Transcript,
    outputLanguage: OutputLanguage,
    customInstruction: string,
    videoTitle: string,
    signal: AbortSignal,
  ): Promise<QuestionContext> {
    if (this.context?.transcript !== transcript || this.context.outputLanguage !== outputLanguage) {
      const value = prepareQuestionContext(
        transcriptToText(transcript), outputLanguage, signal, customInstruction, videoTitle,
      );
      const entry = { transcript, outputLanguage, value };
      this.context = entry;
      // A failed or aborted preparation must not be reused by the next question.
      value.catch(() => { if (this.context === entry) this.context = null; });
    }
    const context = await this.context.value;
    this.condensed = context.condensed;
    return context;
  }

  private scheduleAnswerRender(turn: ChatTurn): void {
    if (this.renderFrameId !== null) return;
    this.renderFrameId = requestAnimationFrame(() => {
      this.renderFrameId = null;
      const panel = this.host.currentPanel();
      const target = this.streamingAnswerEl;
      if (!panel || panel.getMode() !== "chat" || !target?.isConnected) return;
      const content = panel.getContentElement();
      const nearBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 48;
      renderStreaming(target, turn.answer);
      if (nearBottom) content.scrollTop = content.scrollHeight;
    });
  }

  private renderIfVisible(scrollToEnd = false): void {
    const panel = this.host.currentPanel();
    if (panel?.getMode() === "chat") this.render(panel, scrollToEnd);
  }

  private render(panel: Panel, scrollToEnd = false): void {
    const content = panel.getContentElement();
    const nearBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 48;
    content.replaceChildren();
    this.streamingAnswerEl = null;

    if (this.condensed) {
      const notice = document.createElement("div");
      notice.className = "vas-chat-notice";
      notice.textContent = t("askCondensedNotice");
      content.appendChild(notice);
    }
    if (!this.turns.length) {
      const empty = document.createElement("div");
      empty.className = "vas-chat-empty";
      empty.textContent = t("askEmptyHint");
      content.appendChild(empty);
    }
    for (const turn of this.turns) {
      const wrapper = document.createElement("div");
      wrapper.className = "vas-chat-turn";
      const question = document.createElement("div");
      question.className = "vas-chat-question";
      question.textContent = turn.question;
      const answer = document.createElement("div");
      answer.className = "vas-chat-answer";
      if (turn.answer) renderStreaming(answer, turn.answer);
      wrapper.append(question, answer);

      const status = document.createElement("div");
      status.className = "vas-chat-status";
      if (turn.state === "pending") status.textContent = t("askPreparing");
      else if (turn.state === "streaming" && !turn.answer) status.textContent = t("aiThinking");
      else if (turn.state === "stopped") status.textContent = t("askStopped");
      else if (turn.state === "error") {
        status.className = "vas-chat-error";
        status.textContent = turn.error ?? t("translationFailed");
      }
      if (status.textContent) wrapper.appendChild(status);
      if (turn.state === "pending" || turn.state === "streaming") this.streamingAnswerEl = answer;
      content.appendChild(wrapper);
    }
    if (scrollToEnd || nearBottom) content.scrollTop = content.scrollHeight;
  }
}
