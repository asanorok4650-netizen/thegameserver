import { useEffect, useRef } from 'react';
import { Stage } from '../avatar/stage.js';
import { buildAvatar } from '../avatar/builder.js';

// Three.jsのステージをReactに載せる薄いラッパー。
// マウント時にStageを作り、アンマウント時にdisposeする。desc が変わるたびにパーツを組み直す。
export default function AvatarStage({ desc, onBuilt }) {
  const hostRef = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    const stage = new Stage();
    stage.attachTo(hostRef.current);
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !desc) return;
    const built = buildAvatar(desc);
    stage.setAvatar(built);
    if (onBuilt) onBuilt(built);
  }, [desc]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={hostRef} className="avatar-stage" />;
}
