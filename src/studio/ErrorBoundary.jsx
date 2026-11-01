import { Component } from 'react';

/** 描画中のエラーで画面全体が真っ白にならないようにする。下書きの破棄ボタンつき(壊れた下書きから抜け出せる) */
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Studio render error', error, info && info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="studio-root" style={{ alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 12 }}>
        <strong>Studioでエラーが起きました</strong>
        <code style={{ fontSize: 12, maxWidth: 560, wordBreak: 'break-word' }}>{String(this.state.error && this.state.error.message || this.state.error)}</code>
        <div className="st-row" style={{ justifyContent: 'center' }}>
          <button className="secondary-button" type="button" onClick={() => this.setState({ error: null })}>もう一度試す</button>
          <button className="secondary-button" type="button" onClick={async () => {
            try { const { clearDraft } = await import('./storage.js'); await clearDraft(); } catch { /* 無視 */ }
            this.setState({ error: null });
          }}>下書きを破棄して再開</button>
          {this.props.onExit && <button className="secondary-button" type="button" onClick={this.props.onExit}>戻る</button>}
        </div>
      </div>
    );
  }
}
