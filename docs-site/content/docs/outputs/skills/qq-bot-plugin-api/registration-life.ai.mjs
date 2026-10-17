/**
 * RegistrationLife 在生成物（说明书 qq-bot-plugin-api）里变成什么：只写结论，不逐步展开——说明书每次触发都读一遍。
 * 逐步的画面与说明在站上看；这段结论跟 registration-life.data.mjs 里的七步说的是同一件事。
 * 这个文件不 import React，docfirst.config.mjs 引它，命令行也能运行。
 */
export function RegistrationLife(_node, { paragraph }) {
  return [
    paragraph(
      'qq-bot 重载时，注册表随旧的服务对象一起没了，依赖 gwbQqBot 的作用域被撤掉；新的服务对象出现后回调再运行一次，重新注册。' +
        '你的插件重载或卸载时作用域撤掉，注册跟着撤掉；旧的撤掉函数只撤它自己那一份，就算晚于新注册才被调用，也不会撤掉之后同名的新注册。',
    ),
  ];
}
