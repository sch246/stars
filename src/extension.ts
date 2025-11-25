import * as vscode from 'vscode';
import { getUri } from './utilities/getUri'; // 假设存在
import { getNonce } from './utilities/getNonce'; // 假设存在
import { TextDecoder, TextEncoder } from 'util';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('stars.openGraph', () => {
      StarsPanel.createOrShow(context.extensionUri);
    })
  );
}

class StarsPanel {
  public static currentPanel: StarsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _storageUri: vscode.Uri | undefined;
  private _fileWatcher: vscode.FileSystemWatcher | undefined;
  private _isSaving: boolean = false;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
      this._panel = panel;
      this._extensionUri = extensionUri;
      this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);
      
      this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
      
      this._initData(); // 确保文件路径和监听器先初始化
      this._panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case 'alert':
              // 为了兼容性，Webview 不支持原生 alert。这里可以考虑替换为 showInformationMessage
              vscode.window.showInformationMessage(message.text);
              return;
            case 'ready': // 🔹 前端加载完毕，现在发送数据
              console.log("Stars Extension: Webview ready, sending initial data.");
              
              // 🔴 新增：发送语言设置
              this._panel.webview.postMessage({ 
                  command: 'setLanguage', 
                  lang: vscode.env.language 
              });

              await this._loadAndSend();
              return;
            case 'saveData': // 前端请求保存
              await this._saveToDisk(message.data);
              return;
            case 'resetSystem': // 接收前端的重置请求
              await this._saveToDisk(this._createDefaultData()); // 写入默认数据
              await this._loadAndSend(); // 重新加载并发送
              // vscode.window.showInformationMessage("Stars: 系统已重置为默认状态。"); // 统一由前端进行提示
              return;
          }
        },
        null,
        this._disposables
      );
  }

  // 1. 初始化路径
  private async _initData() {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const rootUri = vscode.workspace.workspaceFolders[0].uri;
        this._storageUri = vscode.Uri.joinPath(rootUri, '.stars.json');
        
        // 启动监听器
        this._setupFileWatcher(rootUri);
    } else {
        // 🔴 国际化：使用翻译键
        vscode.window.showWarningMessage("Stars: " + (globalThis.t ? globalThis.t('status.noWorkspace') : "Please open a folder to save data."));
    }
  }

  private _setupFileWatcher(rootUri: vscode.Uri) {
      // 创建监听器，只监听 .stars.json
      const pattern = new vscode.RelativePattern(rootUri, '.stars.json');
      this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
      
      this._fileWatcher.onDidChange(async (uri) => {
          if (this._isSaving) {
              this._isSaving = false; // 重置标志
              return; // 如果是我们自己保存，则忽略此次文件变化事件
          }
          console.log("Stars: External file change detected. Reloading data.");
          // 如果 Webview 已经存在，才发送消息
          if (StarsPanel.currentPanel?._panel.webview) {
            await this._loadAndSend(); 
          }
      });
      
      this._disposables.push(this._fileWatcher);
  }

  // 2. 读取磁盘并发送给前端
  private async _loadAndSend() {
      if (!this._storageUri) {
          // 🔴 国际化：使用翻译键
          vscode.window.showWarningMessage("Stars: " + (globalThis.t ? globalThis.t('status.noWorkspace') : "No workspace folder found, cannot load or save data."));
          return;
      }
      try {
          const fileData = await vscode.workspace.fs.readFile(this._storageUri);
          const jsonString = new TextDecoder().decode(fileData);
          const data = JSON.parse(jsonString);
          
          this._panel.webview.postMessage({ command: 'loadData', data: data });
      } catch (e: any) { // e 可以是 Node.js Error 类型
          // 文件不存在或读取失败，发送默认数据
          console.log(`Stars Extension: Error reading .stars.json: ${e.message}. Sending default data.`);
          const defaultData = this._createDefaultData();
          // 🔹 关键：如果文件不存在，我们先把它写入磁盘，然后再发送。
          // 这样确保下次加载时文件已存在，且文件监听器能正常工作。
          await this._saveToDisk(defaultData); 
          this._panel.webview.postMessage({ command: 'loadData', data: defaultData });
      }
  }

  private _createDefaultData() {
    const DEFAULT_PRESETS = [
        { label: '包含...', val: 'comp', color: '#0062ff' },
        { label: '定义为...', val: 'def', color: '#00ff00' },
        { label: '直观理解', val: 'ins', color: '#33ffff' },
        { label: '计算...', val: 'calc', color: '#ffaa00' },
        { label: '意味着...', val: 'impl', color: '#bd00ff' },
        { label: '与...正交', val: 'orth', color: '#ff0055' },
    ];
      return {
          data: {
              nodes: [{
                  uuid: "origin-root",
                  label: "Origin", // 🔴 这部分将在前端初始化时被 t() 替换
                  isRoot: true,
                  x: 0,
                  y: 0,
                  summary: "Workspace Root", // 🔴 这部分将在前端初始化时被 t() 替换
                  content: "Welcome to Stars in VSCode. Start exploring!", // 🔴 这部分将在前端初始化时被 t() 替换
                  color: "#ffffff"
              }],
              links: []
          },
          slots: [null, null, null, null],
          viewLayers: 1,
          presets: JSON.parse(JSON.stringify(DEFAULT_PRESETS))
      };
  }

  // 3. 保存数据到磁盘
  private async _saveToDisk(data: any) {
      if (!this._storageUri) return;
      try {
          this._isSaving = true; // 🔴 标记为正在保存
          const jsonString = JSON.stringify(data, null, 2);
          await vscode.workspace.fs.writeFile(this._storageUri, new TextEncoder().encode(jsonString));
          // 🔴 国际化：使用翻译键
          vscode.window.setStatusBarMessage(globalThis.t ? globalThis.t('status.saved') : "Stars: Saved.", 2000);
      } catch (e) {
          vscode.window.showErrorMessage(`Stars Save Error: ${e}`);
      }
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (StarsPanel.currentPanel) {
      StarsPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'starsGraph',
      'Stars Graph',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'), // 允许访问 media 文件夹下的所有资源
        ],
      }
    );

    StarsPanel.currentPanel = new StarsPanel(panel, extensionUri);
  }

  public dispose() {
    StarsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
      // 1. 获取所有文件的磁盘路径 URI
      const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
      const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
      const d3Uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'd3.v7.min.js'));
      const uuidUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'uuid.min.js'));
      const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'marked.min.js'));
      const highlightJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'highlight.min.js'));
      const highlightCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'atom-one-dark.min.css'));
      // 🔴 新增：i18n.js 的 URI
      const i18nUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'i18n.js'));


      const nonce = getNonce(); // 保持使用 nonce 以确保安全
      // 2. 返回 HTML，注意 CSP 设置
      return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="
              default-src 'none';
              style-src ${webview.cspSource} 'unsafe-inline'; 
              script-src 'nonce-${nonce}';
              img-src ${webview.cspSource} https: data:;
              connect-src 'self';
          ">
          <link href="${stylesUri}" rel="stylesheet">
          <link href="${highlightCssUri}" rel="stylesheet">
          <title>Stars</title>
      </head>
      <body>
          <div id="hud">
              <h1><span id="txt-hud-title">Stars</span> <span style="font-size:10px; opacity:0.5">v4.4 Flow</span></h1>
              <div id="slot-bar">
                  <div class="slot" id="slot-1"><div class="slot-circle"><span class="slot-num">1</span></div><span class="slot-name">-</span></div>
                  <div class="slot" id="slot-2"><div class="slot-circle"><span class="slot-num">2</span></div><span class="slot-name">-</span></div>
                  <div class="slot" id="slot-3"><div class="slot-circle"><span class="slot-num">3</span></div><span class="slot-name">-</span></div>
                  <div class="slot" id="slot-4"><div class="slot-circle"><span class="slot-num">4</span></div><span class="slot-name">-</span></div>
              </div>
              <div id="view-controls">
                  <span id="txt-view-range">视野范围:</span> <span id="layer-indicator">1</span> <span id="txt-layers">层</span> (<span id="txt-adjust">按 +/- 调整</span>)<br>
                  <span id="txt-visible">当前可见:</span> <span id="visible-count">0</span> <span id="txt-nodes">节点</span>
              </div>
              <div id="link-mode-indicator">🔗 连线模式: 跳转以连接/Esc 取消</div>
              <div id="key-controls" class="controls">
                  <!-- 这部分会由 JS 动态填充 -->
              </div>
          </div>

          <div id="flash-message"></div>
          <div id="relation-picker" class="overlay-menu"></div>

          <div id="preset-editor">
              <div class="menu-title"><span id="txt-preset-editor-title">预设关系编辑器</span> <span id="preset-editor-close-btn" style="float:right; cursor:pointer">✕</span></div>
              <div class="controls" style="margin-bottom:10px; color:#666;" id="txt-preset-editor-desc">定义常用的连接类型。按 Enter 保存。</div>
              <div class="preset-list" id="preset-list-container"></div>
              <div class="preset-actions">
                  <button id="add-preset-btn">+ 新增预设</button>
                  <button class="btn-primary" id="save-presets-btn">保存并应用</button>
              </div>
          </div>

          <div id="content-modal"><div id="modal-body"></div></div>

          <div id="io-controls">
              <button id="save-btn">保存</button>
              <button id="export-btn">导出</button>
              <button id="reset-system-btn">重置系统</button>
              <input type="file" id="importFile" style="display:none">
              <button id="import-btn">导入</button>
              <button id="manage-presets-btn">预设管理</button>
          </div>

          <div id="sidebar">
              <input type="text" id="node-label" placeholder="概念名称">
              <div id="node-uuid">UUID: -</div>
              <div id="link-status">连接数: -</div>
              <textarea id="node-summary" placeholder="简短摘要 (Markdown/HTML)..."></textarea>
              <div id="node-color-container">
                  <input type="color" id="node-color-input">
                  <input type="text" id="node-color-hex" placeholder="#FFFFFF">
              </div>
              <textarea id="node-content" placeholder="详细笔记 (Markdown支持)..."></textarea>
          </div>
          <div id="sidebar-resizer"></div>
          <div id="tooltip"></div>
          <canvas id="canvas"></canvas>

          <!-- 🔴 新增：自定义弹窗容器 -->
          <div id="custom-dialog-overlay">
            <div id="custom-dialog">
                <div id="custom-dialog-msg"></div>
                <input type="text" id="custom-dialog-input" placeholder="">
                <div id="custom-dialog-buttons">
                    <button id="btn-cancel">取消</button>
                    <button id="btn-confirm" class="btn-primary">确定</button>
                </div>
            </div>
          </div>

          <script nonce="${nonce}" src="${d3Uri}"></script>
          <script nonce="${nonce}" src="${uuidUri}"></script>
          <script nonce="${nonce}" src="${markedUri}"></script>
          <script nonce="${nonce}" src="${highlightJsUri}"></script>
          
          <!-- 🔴 确保 i18n.js 在 main.js 之前加载，以便 main.js 可以使用 t() 函数 -->
          <script nonce="${nonce}" src="${i18nUri}"></script>
          <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
