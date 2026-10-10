const TAU = Math.PI * 2;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let data = { nodes: [], edges: [], issues: [], log: [] };
let uni = null;                    // 内核里的 Universe(Map 结构)
const bridges = new Map();         // 页面桥:暗号 → { nonce, frame, path, level, subs, kind: page | script, author }(见「页面桥」一节)
let bridge = null;                 // 其中侧栏里的那个页面
const scripts = new Map();         // 查看器里跑着的脚本:路径 → { path, frame, b, started, state, finished }(见「脚本」一节)
let specs = {}, viewErrors = [], viewNames = [];
let scene = { look: 'galaxy', nodes: [], edges: [], expand: { relation: 'contains' } };
const manual = new Map();          // id -> true/false:用户手动展开/收起,优先级最高
const auto = new Map();            // id -> true/false:语义缩放自动决定
let tagColor = new Map();
let activeTags = new Set();         // tag 视图里被点亮的 tag(容器 id)
let drawNodes = [];                // 已按绘制顺序排好(星云在下),只在图变化时重建
let labelNodes = [], labelKey = '', labelAt = 0;
let regions = [];                  // 展开的容器及其可见后代
let known = new Set();             // 已知的宇宙节点 id(用来区分"新生"和"只是展开了")
let look = 'galaxy';
let currentView = (location.hash.match(/view=([\w-]+)/) || [])[1] || 'galaxy';
let projectId = (location.hash.match(/[#&]p=([0-9a-f]+)/) || [])[1] || null;   // null = 服务启动时的主项目
let project = null;                // 当前项目的信息(快照里带来的)
const reopenTried = new Set();
const setHash = () => { history.replaceState(null, '', '#view=' + currentView + (projectId ? '&p=' + projectId : '')); };
// 记住 项目 id → 目录:服务重启后其它项目没打开,带着 #p= 刷新时能自动重新打开
const dirsKey = 'stars.projectDirs';
const knownDirs = () => { try { return JSON.parse(localStorage.getItem(dirsKey) || '{}'); } catch { return {}; } };
const rememberDir = (id, dir) => { try { localStorage.setItem(dirsKey, JSON.stringify({ ...knownDirs(), [id]: dir })); } catch { /* 隐私模式 */ } };
let es = null;
const sim = new Map();            // id -> 模拟节点(保留位置)
const raw = new Map();            // id -> 宇宙里的原始节点
let links = [];
let hiddenTypes = new Set();
let selected = null, hovered = null, query = '';
// 多选:selection 是选中的集合,selected 是其中的「主」节点(最后点的那个;侧栏详情、跟随、双击、E 都按它)。
// 不变式:selected 不为空时一定在 selection 里;只选了一个时两者一样。selVer 每改一次集合加一(缓存用)
const selection = new Set();
let selVer = 0;
const pendingExpand = new Set();   // 刚打包出来的域:视图编译出它(是个容器)时就地展开(见「打包」)
const spawnAt = new Map();         // 刚新建的节点 id → { key: 空间(平铺 = '*'), x, y }:出生在双击的位置(见「新建节点」)
let selEdge = null;                // 选中的边:{ from, type, to } 或汇总边 { lifted: true, from, type, to, count }(见「关系」一节)
// 过滤:query 是过滤框里的字(以 = 开头就是表达式);qActive 是点亮的保存的查询(动态区域)。filt = 两者有一个在起作用
let filt = false, qActive = null, qErr = '';
let transform = d3.zoomIdentity;
let userMoved = false;
let curK = 1;                    // 当前正在绘制的空间的屏幕尺度(LOD 用)
let draftSpec = null, editorDirty = false;   // 编辑器里尚未保存的视图规格(实时预览)
let hist = null;                 // git 提交图
let lastUserZoom = -1e9;         // 语义缩放只响应用户自己的缩放/平移,不响应自动适应窗口
let fresh = true;                 // 第一次收到某个视图的数据:不播放出生动画,并自动适应窗口
let placeTimer = null;            // 记住所在的空间与展开状态(见 savePlace)
let issueByNode = new Map();
let edgeColors = new Map();
