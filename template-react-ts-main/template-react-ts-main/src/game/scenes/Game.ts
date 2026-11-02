import { Scene } from "phaser";
import { EventBus } from "../EventBus";

export class Game extends Scene {
  private playerHp = 100;
  private enemyHp = 100;
  private playerBar!: Phaser.GameObjects.Rectangle;
  private enemyBar!: Phaser.GameObjects.Rectangle;
  private status!: Phaser.GameObjects.Text;

  constructor() { super("StudyEncounter"); }

  create() {
    this.cameras.main.setBackgroundColor("#121b31");
    this.add.text(32, 23, "STUDY ARENA", { fontFamily: "Arial", fontSize: "20px", color: "#9fe7d2" });
    this.add.text(32, 58, "Correct answers damage the sentinel. Wrong answers cost health.", { fontFamily: "Arial", fontSize: "13px", color: "#aab6d3" });
    this.add.text(80, 125, "STUDENT", { fontFamily: "Arial", fontSize: "13px", color: "#e7efff" });
    this.add.text(455, 125, "EXAM SENTINEL", { fontFamily: "Arial", fontSize: "13px", color: "#ffb0a8" });
    this.add.rectangle(80, 153, 230, 18, 0x273453).setOrigin(0);
    this.add.rectangle(410, 153, 230, 18, 0x273453).setOrigin(0);
    this.playerBar = this.add.rectangle(80, 153, 230, 18, 0x61d9ac).setOrigin(0);
    this.enemyBar = this.add.rectangle(410, 153, 230, 18, 0xf47f76).setOrigin(0);
    this.status = this.add.text(360, 230, "Answer the question below to attack", {
      fontFamily: "Arial", fontSize: "15px", color: "#ffffff", align: "center",
      wordWrap: { width: 640 },
    }).setOrigin(.5);
    EventBus.emit("current-scene-ready", this);
  }

  resolve(correct: boolean, totalQuestions = 3) {
    if (!this.scene.isActive()) return;
    const damage = Math.ceil(100 / Math.max(1, totalQuestions));
    if (correct) this.enemyHp = Math.max(0, this.enemyHp - damage);
    else this.playerHp = Math.max(0, this.playerHp - 22);
    this.playerBar.width = 230 * this.playerHp / 100;
    this.enemyBar.width = 230 * this.enemyHp / 100;
    this.status.setText(correct
      ? this.enemyHp === 0 ? "Sentinel defeated — encounter cleared!" : "Concept strike! Sentinel loses " + damage + " HP."
      : this.playerHp === 0 ? "Student defeated — review and retry." : "The sentinel counterattacks. You lose 22 HP.");
    this.status.setColor(correct ? "#9fe7d2" : "#ffb0a8");
  }

  reset() {
    this.playerHp = 100;
    this.enemyHp = 100;
    if (!this.playerBar || !this.enemyBar || !this.status) return;
    this.playerBar.width = 230;
    this.enemyBar.width = 230;
    this.status.setText("Answer the question below to attack").setColor("#ffffff");
  }
}
