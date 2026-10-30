export default function LibrarySection({ onOpenFile }) {
  return (
    <section className="section-block" id="library-section">
      <div className="section-heading">
        <div>
          <h2>ゲームライブラリ</h2>
          <p>このブラウザで開いたワールド。</p>
        </div>
      </div>
      <button className="upload-panel" id="upload-panel" onClick={onOpenFile}>
        <span className="upload-icon">↥</span>
        <span className="upload-copy">
          <strong>ワールドを追加</strong>
          <small>.rbxl または .rbxlx ファイルを選択</small>
        </span>
        <span className="upload-arrow">→</span>
      </button>
    </section>
  );
}
