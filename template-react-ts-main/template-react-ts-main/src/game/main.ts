import { AUTO, Game } from "phaser";
import { Game as StudyGame } from "./scenes/Game";
const config: Phaser.Types.Core.GameConfig = { type: AUTO, width: 720, height: 300, parent: "game-container", backgroundColor: "#121b31", scene: [StudyGame], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } };
const StartGame = (parent: string) => new Game({ ...config, parent });
export default StartGame;
