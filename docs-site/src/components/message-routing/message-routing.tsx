'use client';
/**
 * 「一条消息分到哪」：选一种情况，左边是手机上发的那条（第一段标出来）和机器人回的话，右边是五道检查，
 * 高亮它依次经过的检查、每一道的回答和最后落在哪个结论上。讲解文字与数据都在 message-routing.data.mjs，
 * 情况胶囊与每种情况的说明由 CasePicker 显示。
 */
import { CasePicker, Pane, Pill } from '@godcreator/docfirst-explainer';
import type { Tone } from '@godcreator/docfirst-explainer';
import { cases, checks, kindLabels } from './message-routing.data.mjs';

type Case = (typeof cases)[number];
type Kind = keyof typeof kindLabels;

const toneOfKind: Record<Kind, Tone> = { task: 'good', answer: 'info', refuse: 'warn' };

const outcomes = checks.flatMap((c) => c.outs);

/** 第一段是第一个空白之前的那一段；不以斜杠开头的消息没有第一段可言，整条都是正文 */
function MessageBubble({ message }: { message: string }) {
  const space = /\s/u.exec(message);
  if (!message.startsWith('/')) return <div className="mr-bubble mr-in">{message}</div>;
  const head = space === null ? message : message.slice(0, space.index);
  const rest = space === null ? '' : message.slice(space.index);
  return (
    <div className="mr-bubble mr-in">
      <mark className="mr-head">{head}</mark>
      {rest}
    </div>
  );
}

function Ladder({ current }: { current: Case }) {
  const answers = new Map(current.path.map(([id, answer]) => [id, answer]));
  return (
    <ol className="mr-ladder">
      {checks.map((c, i) => {
        const answer = answers.get(c.id);
        return (
          <li key={c.id} className="mr-check" data-reached={answer !== undefined}>
            <span className="num">{i + 1}</span>
            <span className="q">
              {c.q}
              {answer !== undefined ? <Pill role="blue">{answer}</Pill> : null}
            </span>
            <span className="d">{c.detail}</span>
            {c.outs.length > 0 ? (
              <span className="mr-outs">
                {c.outs.map((o) => (
                  <span key={o.id} className="mr-out" data-hit={o.id === current.result}>
                    <Pill tone={toneOfKind[o.kind as Kind]} dot>
                      {o.when} → {o.label}
                    </Pill>
                  </span>
                ))}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Routing({ current }: { current: Case }) {
  const result = outcomes.find((o) => o.id === current.result)!;
  const kind = result.kind as Kind;
  return (
    <div className="mr-stage">
      <div className="mr-grid">
        <div className="mr-chat">
          <Pane title="手机 QQ 私聊" role="slate" icon="user">
            <div className="mr-thread">
              <MessageBubble message={current.message} />
              {/* 每种情况换 key，回复气泡与结论胶囊重新挂载，出现动画重放一次 */}
              <div key={current.id} className="mr-bubble mr-out-bubble">
                {current.reply}
              </div>
            </div>
          </Pane>
          <Pill key={current.id} tone={toneOfKind[kind]} dot>
            {kindLabels[kind]}：{result.label}
          </Pill>
        </div>
        <Ladder current={current} />
      </div>
    </div>
  );
}

export function MessageRouting() {
  return (
    <CasePicker cases={cases} initial={cases[1]!.id} label="选一条消息">
      {(current) => <Routing current={current} />}
    </CasePicker>
  );
}
