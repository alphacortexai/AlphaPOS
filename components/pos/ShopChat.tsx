'use client';

import { useEffect, useRef, useState } from 'react';
import { answerShopQuestion, type ChatContext, type ChatLine, type ShopChatSnapshot } from '../../lib/pos/assistantChat';

const PROMPTS = [
  'Sales today',
  'Sales this week',
  'Profit this month',
  'How many products do we have?',
  'What is low on stock?',
  'What are the prices?',
  'Which services are available?',
];

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  lines: ChatLine[];
};

const welcome = (): Message => ({
  id: 'welcome',
  role: 'assistant',
  text: 'Ask about sales, profit, stock, prices, or services. The figures are this shop\'s own records.',
  lines: [],
});

export default function ShopChat({ snapshot }: { snapshot: ShopChatSnapshot }) {
  const [messages, setMessages] = useState<Message[]>([welcome()]);
  const [draft, setDraft] = useState('');
  const contextRef = useRef<ChatContext>({});
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const ask = (value: string) => {
    const question = value.trim();
    if (!question) return;
    const reply = answerShopQuestion(question, snapshot, { context: contextRef.current });
    if (reply.topic !== 'help') {
      contextRef.current = {
        topic: reply.topic,
        period: reply.period ?? contextRef.current.period,
        productId: reply.productId,
        serviceId: reply.serviceId,
      };
    }
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', text: question, lines: [] },
      { id: crypto.randomUUID(), role: 'assistant', text: reply.text, lines: reply.lines },
    ]);
    setDraft('');
    inputRef.current?.focus();
  };

  return (
    <div className="shop-chat">
      <p className="muted-copy shop-chat-lead">
        Answers use the same business day as reports. Voided sales are left out. A week starts on Monday. Name a period such as today, this week, or from 1 Nov to 10 Nov.
      </p>
      <div className="shop-chat-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message) => (
          <article key={message.id} className={`shop-chat-bubble ${message.role}`}>
            <p>{message.text}</p>
            {message.lines.length > 0 && (
              <ul className="shop-chat-lines">
                {message.lines.map((line, index) => (
                  <li key={`${message.id}-${index}`}>
                    <span>{line.label}</span>
                    <b>{line.detail}</b>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
      <div className="shop-chat-suggestions">
        {PROMPTS.map((prompt) => (
          <button key={prompt} type="button" onClick={() => ask(prompt)}>{prompt}</button>
        ))}
      </div>
      <form className="shop-chat-form" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
        <input
          ref={inputRef}
          value={draft}
          maxLength={300}
          placeholder="Ask about sales, stock, prices, profit, or services"
          aria-label="Ask the assistant"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="primary" disabled={!draft.trim()}>Send</button>
      </form>
    </div>
  );
}
