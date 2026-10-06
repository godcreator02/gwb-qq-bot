// src/site/qq-notifications.ts
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
var QqNotifications = class {
  constructor(deps) {
    this.deps = deps;
    this.queue = deps.read().then((raw) => {
      if (raw === void 0) return;
      const doc = raw;
      if (doc.version !== 1 || !Array.isArray(doc.observations) || !Array.isArray(doc.results)) throw new Error("\u534F\u4F5C\u7AD9 QQ \u901A\u77E5\u8BB0\u5F55\u683C\u5F0F\u4E0D\u6B63\u786E");
      this.book = doc;
    });
  }
  deps;
  book = { version: 1, observations: [], results: [] };
  queue;
  serial(run) {
    const next = this.queue.then(run);
    this.queue = next.catch(() => {
    });
    return next;
  }
  save() {
    return this.deps.write(this.book);
  }
  observe(repo, attention) {
    return this.serial(async () => {
      if (!this.deps.enabled()) return;
      const pulls = [...attention.pendingPulls ?? []].sort((a, b) => a.url.localeCompare(b.url));
      const problems = [attention.checkError, attention.syncProblem, attention.submitFailure].filter((text) => text !== null);
      if (attention.conflicts.length > 0) problems.push(`\u6709 ${attention.conflicts.length} \u4E2A\u51B2\u7A81\u6587\u4EF6`);
      const fingerprint = JSON.stringify({ pulls, problems });
      let observation = this.book.observations.find((item) => item.repo === repo);
      if (observation === void 0) {
        observation = { repo, fingerprint: "", revision: 0, text: "", pending: false };
        this.book.observations.push(observation);
      }
      if (observation.fingerprint !== fingerprint) {
        observation.fingerprint = fingerprint;
        observation.revision++;
        const lines = pulls.map((pull) => `${pull.repo} MR #${pull.number}\uFF1A${pull.title}\uFF08${pull.poster}\uFF09`);
        observation.text = [`\u534F\u4F5C\u7AD9 ${path.basename(repo)}`, ...lines, ...problems].join("\n").slice(0, 600);
        observation.pending = lines.length > 0 || problems.length > 0;
        await this.save();
      }
      if (!observation.pending) return;
      const repoId = createHash("sha256").update(repo).digest("hex").slice(0, 24);
      await this.notify(`collab-${repoId}-${observation.revision}`, observation.text);
      observation.pending = false;
      await this.save();
    });
  }
  prepareAi(repo) {
    return this.serial(async () => {
      if (!this.deps.enabled()) return void 0;
      const id = randomUUID();
      this.book.results.push({ id, repo, state: "pending", text: null, taskId: null });
      await this.save();
      return { id, callback: "collab.receive-report", server: this.deps.server() };
    });
  }
  receive(raw) {
    return this.serial(async () => {
      const report = raw;
      if (report === null || typeof report !== "object" || typeof report.text !== "string" || typeof report.taskId !== "string" || !["completed", "failed", "needs_input"].includes(report.state ?? "")) throw new Error("\u534F\u4F5C\u7AD9\u56DE\u62A5\u683C\u5F0F\u4E0D\u6B63\u786E");
      const result = this.book.results.find((each) => each.id === report.id);
      if (result === void 0 || result.repo !== report.workspace) throw new Error("\u672C home \u6CA1\u6709\u8FD9\u6B21\u534F\u4F5C\u7AD9\u6D3E\u5355");
      if (result.text !== null && (result.text !== report.text || result.state !== report.state)) throw new Error("\u8BE5\u534F\u4F5C\u4EFB\u52A1\u5DF2\u6709\u4E0D\u540C\u7ED3\u679C");
      result.text = report.text;
      result.state = report.state;
      result.taskId = report.taskId;
      await this.save();
      if (this.deps.enabled()) await this.notify(`collab-ai-${result.id}`, `\u534F\u4F5C\u7AD9 ${path.basename(result.repo)}\uFF1A${result.state}
${result.text}`.slice(0, 600));
      return { accepted: true };
    });
  }
  async notify(id, text) {
    try {
      const sent = await this.deps.commands.run("qq-bot.notify", { id, text });
      if (!sent.ok || !sent.data?.delivered) this.deps.warn(`QQ \u901A\u77E5 ${id} \u672A\u9001\u8FBE\uFF0C\u7ED3\u679C\u4ECD\u4FDD\u7559\u5728\u534F\u4F5C\u7AD9`);
    } catch {
      this.deps.warn(`QQ \u901A\u77E5 ${id} \u8C03\u7528\u5931\u8D25\uFF0C\u7ED3\u679C\u4ECD\u4FDD\u7559\u5728\u534F\u4F5C\u7AD9`);
    }
  }
  async results() {
    await this.queue;
    return structuredClone(this.book.results);
  }
  async close() {
    await this.queue;
  }
};
export {
  QqNotifications
};
