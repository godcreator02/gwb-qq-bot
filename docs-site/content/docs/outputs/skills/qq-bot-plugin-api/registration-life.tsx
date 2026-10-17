/**
 * 「注册跟着两边的启停走」：分步看协作站的作用域、qq-bot 的服务对象与注册表、手机私聊三块怎么一起变。
 * 讲解文字与数据都在 registration-life.data.mjs；它放在说明书 qq-bot-plugin-api 的正本里，生成物里的那段结论在 registration-life.ai.mjs。
 * 协作站固定紫色、qq-bot 固定蓝色、手机固定灰色。
 */
import { Pane, Pill, Stepper } from '@godcreator/explainer/site';
import type { Tone } from '@godcreator/explainer/site';
import { scopeLabels, steps } from './registration-life.data.mjs';
import './registration-life.css';

type Step = (typeof steps)[number];

const toneOfScope: Record<Step['plugin']['scope'], Tone> = { waiting: 'pending', active: 'good', gone: 'bad' };

function PluginSide({ step }: { step: Step }) {
  return (
    <Pane title="协作站" role="violet" icon="server">
      <div className="rl-body">
        <Pill tone={toneOfScope[step.plugin.scope]} dot>
          {scopeLabels[step.plugin.scope]}
        </Pill>
        {step.plugin.call === null ? null : (
          <code key={step.title} className="rl-call">
            {step.plugin.call}
          </code>
        )}
      </div>
    </Pane>
  );
}

function ServiceSide({ step }: { step: Step }) {
  const service = step.service;
  return (
    <Pane title="gwbQqBot" role="blue" icon="server" extra={service === null ? null : <span className="rl-dim">服务对象 #{service.instance}</span>}>
      <div className="rl-body">
        {service === null ? (
          <span className="rl-dim">此刻没有这个服务</span>
        ) : (
          <>
            <span className="rl-dim">注册表</span>
            {service.registry.length === 0 ? <span className="rl-dim">空</span> : null}
            {service.registry.map((entry) => (
              <span key={`${service.instance}-${entry.copy}`} className="rl-entry">
                <Pill role="violet">{entry.command}</Pill>
                <span className="rl-dim">协作站第 {entry.copy} 份</span>
              </span>
            ))}
          </>
        )}
      </div>
    </Pane>
  );
}

function PhoneSide({ step }: { step: Step }) {
  const phone = step.phone;
  return (
    <Pane title="手机 QQ 私聊" role="slate" icon="user">
      <div className="rl-thread">
        {phone === null ? (
          <span className="rl-dim">没有动静</span>
        ) : (
          <>
            <div key={`${step.title}-in`} className="rl-bubble rl-in">{phone.send}</div>
            <div key={`${step.title}-out`} className="rl-bubble rl-out">
              <Pill tone={phone.tone} dot>{phone.reply}</Pill>
            </div>
          </>
        )}
      </div>
    </Pane>
  );
}

export function RegistrationLife() {
  return (
    <Stepper steps={steps} label="注册跟着两边的启停走">
      {(step) => (
        <div className="rl-grid">
          <PluginSide step={step} />
          <ServiceSide step={step} />
          <PhoneSide step={step} />
        </div>
      )}
    </Stepper>
  );
}
