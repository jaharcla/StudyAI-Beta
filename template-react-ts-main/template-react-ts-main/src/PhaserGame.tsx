<<<<<<< HEAD
import { forwardRef, useLayoutEffect, useRef } from "react";
import StartGame from "./game/main";
import { EventBus } from "./game/EventBus";

export interface IRefPhaserGame {
  game: Phaser.Game | null;
  scene: Phaser.Scene | null;
}
interface Props {
  currentActiveScene?: (scene: Phaser.Scene) => void;
}

/** Subscribe to the scene event before starting Phaser to avoid missing its first frame. */
export const PhaserGame = forwardRef<IRefPhaserGame, Props>(function PhaserGame({ currentActiveScene }, ref) {
  const game = useRef<Phaser.Game | null>(null);

  useLayoutEffect(() => {
    let alive = true;
    const onReady = (scene: Phaser.Scene) => {
      if (!alive) return;
      currentActiveScene?.(scene);
      const value = { game: game.current, scene };
      if (typeof ref === "function") ref(value);
      else if (ref) ref.current = value;
    };
    EventBus.on("current-scene-ready", onReady);
    game.current = StartGame("game-container");
    const initial = { game: game.current, scene: null };
    if (typeof ref === "function") ref(initial);
    else if (ref) ref.current = initial;

    return () => {
      alive = false;
      EventBus.off("current-scene-ready", onReady);
      game.current?.destroy(true);
      game.current = null;
      if (typeof ref === "function") ref(null);
      else if (ref) ref.current = null;
    };
  }, [currentActiveScene, ref]);

=======
﻿import { forwardRef, useEffect, useLayoutEffect, useRef } from "react";
import StartGame from "./game/main";
import { EventBus } from "./game/EventBus";
export interface IRefPhaserGame { game: Phaser.Game | null; scene: Phaser.Scene | null; }
interface Props { currentActiveScene?: (scene: Phaser.Scene) => void; }
export const PhaserGame = forwardRef<IRefPhaserGame, Props>(function PhaserGame({ currentActiveScene }, ref) {
  const game = useRef<Phaser.Game | null>(null);
  useLayoutEffect(() => { if (!game.current) { game.current = StartGame("game-container"); const value = { game: game.current, scene: null }; if (typeof ref === "function") ref(value); else if (ref) ref.current = value; } return () => { game.current?.destroy(true); game.current = null; }; }, [ref]);
  useEffect(() => { const onReady = (scene: Phaser.Scene) => { currentActiveScene?.(scene); const value = { game: game.current, scene }; if (typeof ref === "function") ref(value); else if (ref) ref.current = value; }; EventBus.on("current-scene-ready", onReady); return () => { EventBus.off("current-scene-ready", onReady); }; }, [currentActiveScene, ref]);
>>>>>>> origin/main
  return <div id="game-container" aria-label="Study encounter game" />;
});
