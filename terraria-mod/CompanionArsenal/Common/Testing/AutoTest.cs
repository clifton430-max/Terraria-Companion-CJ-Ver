using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using CompanionArsenal.Content.Items.Weapons;
using Microsoft.Xna.Framework;
using Terraria;
using Terraria.ID;
using Terraria.IO;
using Terraria.ModLoader;

namespace CompanionArsenal.Common.Testing
{
	/// <summary>
	/// Automated in-game weapon test for developers. Dormant unless <c>terraria-mod/tools/run_ingame_test.sh</c>
	/// writes a fresh request file; the request is deleted as soon as it is read, so normal launches never test.
	///
	/// When requested, the real client enters a throwaway world with a throwaway character (both kept in
	/// <c>{tModLoader save}/CompanionArsenalTest/</c>), holds the "use item" control through the public
	/// <see cref="ModPlayer.SetControls"/> hook so Terraria's own swing code runs, records every hit on two
	/// frozen target slimes, writes <c>results.json</c>, and quits the game.
	/// </summary>
	public class AutoTestSystem : ModSystem
	{
		public const string FolderName = "CompanionArsenalTest";
		/// <summary>Requests older than this are ignored (e.g. left behind by a crashed run).</summary>
		private static readonly TimeSpan RequestMaxAge = TimeSpan.FromMinutes(10);
		private static readonly TimeSpan OverallTimeout = TimeSpan.FromMinutes(4);
		private const int MenuSettleTicks = 90;
		private const int WorldSettleTicks = 120;
		private const int TargetSwings = 30;
		private const int MaxSwingTicks = 60 * 40;

		internal enum Stage { Idle, WaitForMenu, EnteringWorld, WaitInWorld, Swinging, Finished }

		internal static Stage CurrentStage { get; private set; } = Stage.Idle;
		internal static bool Swinging => CurrentStage == Stage.Swinging;
		internal static bool Active => CurrentStage is Stage.WaitInWorld or Stage.Swinging;

		internal static readonly List<int> TargetNpcs = new();
		internal static readonly Dictionary<int, Vector2> Anchors = new();
		internal static readonly List<uint> SwingStarts = new();
		internal static readonly List<(int Damage, bool Crit, string DamageClass)> Hits = new();

		private static string folder;
		private static string runId = "";
		private static readonly Stopwatch clock = new();
		private static int stageTicks;
		private static bool onFireSeen;
		private static bool hooked;

		private static string Folder => folder ??= Path.Combine(Main.SavePath, FolderName);

		public override void Load() {
			if (Main.dedServ)
				return;
			string request = Path.Combine(Folder, "autotest-request.json");
			if (!File.Exists(request))
				return;

			DateTime written = File.GetLastWriteTimeUtc(request);
			try {
				runId = JsonDocument.Parse(File.ReadAllText(request)).RootElement.GetProperty("runId").GetString() ?? "";
			}
			catch (Exception e) {
				Mod.Logger.Warn($"[AutoTest] Unreadable request ignored: {e.Message}");
			}
			File.Delete(request); // consume: one request, one run
			if (DateTime.UtcNow - written > RequestMaxAge) {
				Mod.Logger.Warn("[AutoTest] Stale request ignored.");
				return;
			}

			Mod.Logger.Info($"[AutoTest] Requested (run {runId}); waiting for the main menu.");
			Reset();
			CurrentStage = Stage.WaitForMenu;
			clock.Restart();
			Main.OnTickForThirdPartySoftwareOnly += OnTick;
			hooked = true;
		}

		public override void Unload() {
			if (hooked)
				Main.OnTickForThirdPartySoftwareOnly -= OnTick;
			hooked = false;
			CurrentStage = Stage.Idle;
			folder = null;
		}

		private static void Reset() {
			TargetNpcs.Clear();
			Anchors.Clear();
			SwingStarts.Clear();
			Hits.Clear();
			onFireSeen = false;
			stageTicks = 0;
		}

		private static void Log(string message) => ModContent.GetInstance<CompanionArsenal>().Logger.Info("[AutoTest] " + message);

		/// <summary>Runs every game tick, including on the main menu.</summary>
		private static void OnTick() {
			if (CurrentStage is Stage.Idle or Stage.Finished)
				return;
			if (clock.Elapsed > OverallTimeout) {
				Finish($"timed out in stage {CurrentStage}");
				return;
			}

			switch (CurrentStage) {
				case Stage.WaitForMenu:
					// MenuID.Title is the main menu; wait until it has been stable for a moment after mod loading.
					stageTicks = Main.gameMenu && Main.menuMode == MenuID.Title ? stageTicks + 1 : 0;
					if (stageTicks >= MenuSettleTicks)
						EnterWorld();
					break;
				case Stage.EnteringWorld:
					if (!Main.gameMenu && Main.LocalPlayer.active) {
						Log("In world.");
						CurrentStage = Stage.WaitInWorld;
						stageTicks = 0;
					}
					break;
			}
		}

		private static void EnterWorld() {
			string worldPath = Path.Combine(Folder, "CompanionTest.wld");
			if (!File.Exists(worldPath)) {
				Finish($"test world missing at {worldPath}; run tools/run_ingame_test.sh to create it");
				return;
			}
			var player = new Player { name = "CompanionTest", difficulty = PlayerDifficultyID.SoftCore };
			var playerData = new PlayerFileData(Path.Combine(Folder, "CompanionTest.plr"), false) {
				Name = player.name,
				Player = player,
			};
			playerData.SetAsActive();
			WorldFile.GetAllMetadata(worldPath, false).SetAsActive();
			Log($"Entering {worldPath} as a fresh character.");
			CurrentStage = Stage.EnteringWorld;
			WorldGen.playWorld();
		}

		public override void PostUpdateEverything() {
			if (!Active || Main.dedServ)
				return;
			Player player = Main.LocalPlayer;
			stageTicks++;

			if (CurrentStage == Stage.WaitInWorld) {
				if (stageTicks >= WorldSettleTicks)
					SetUpArena(player);
				return;
			}

			foreach (int i in TargetNpcs) {
				if (Main.npc[i].active && Main.npc[i].HasBuff(BuffID.OnFire))
					onFireSeen = true;
			}
			if (SwingStarts.Count >= TargetSwings + 1 || stageTicks >= MaxSwingTicks)
				Finish(null);
		}

		/// <summary>Daylight, no natural spawns, sword in hand, a frozen target slime on each side.</summary>
		private static void SetUpArena(Player player) {
			Main.dayTime = true;
			Main.time = 27000;
			for (int i = 0; i < Main.maxNPCs; i++) {
				if (Main.npc[i].active && !Main.npc[i].townNPC)
					Main.npc[i].active = false;
			}

			player.inventory[0].SetDefaults(ModContent.ItemType<EmberBlade>());
			player.selectedItem = 0;

			foreach (int side in new[] { -1, 1 }) {
				int x = (int)(player.Center.X + side * 38);
				int y = (int)player.Bottom.Y;
				int index = NPC.NewNPC(Entity.GetSource_None(), x, y, NPCID.BlueSlime);
				NPC npc = Main.npc[index];
				npc.lifeMax = npc.life = 100_000;
				npc.defense = npc.defDefense = 0;
				npc.damage = npc.defDamage = 0;
				TargetNpcs.Add(index);
				Anchors[index] = npc.position;
			}
			Log($"Arena ready: holding {player.HeldItem.Name}, targets {string.Join(",", TargetNpcs)}.");
			CurrentStage = Stage.Swinging;
			stageTicks = 0;
		}

		private static void Finish(string failure) {
			CurrentStage = Stage.Finished;
			var checks = new List<object>();
			bool allPass = failure == null;
			void Check(string name, bool pass, string detail) {
				checks.Add(new { name, pass, detail });
				allPass &= pass;
				Log($"[{(pass ? "PASS" : "FAIL")}] {name}: {detail}");
			}

			var intervals = SwingStarts.Zip(SwingStarts.Skip(1), (a, b) => (int)(b - a)).ToList();
			var normal = Hits.Where(h => !h.Crit).Select(h => h.Damage).ToList();
			var crits = Hits.Where(h => h.Crit).Select(h => h.Damage).ToList();
			int swings = Math.Max(0, SwingStarts.Count - 1); // the last start only closes the final interval

			if (failure != null) {
				Check("harness", false, failure);
			}
			else {
				// Expected per hit vs 0 defence: 22 ± 15% → 19..25; a crit doubles it → 38..50.
				Check("swings performed with autoswing", swings >= TargetSwings, $"{swings} swings");
				Check("use time is 33 ticks", intervals.Count > 0 && intervals.All(t => t == 33),
					$"intervals {string.Join(",", intervals.Distinct())}");
				Check("swing hits a target every time", Hits.Count >= swings, $"{Hits.Count} hits for {swings} swings");
				Check("damage class is melee", Hits.Count > 0 && Hits.All(h => h.DamageClass == nameof(MeleeDamageClass)),
					string.Join(",", Hits.Select(h => h.DamageClass).Distinct()));
				Check("normal hits deal 19-25", normal.Count > 0 && normal.All(d => d is >= 19 and <= 25),
					normal.Count > 0 ? $"{normal.Min()}..{normal.Max()} over {normal.Count} hits" : "no normal hits");
				Check("critical hits deal 38-50", crits.All(d => d is >= 38 and <= 50),
					crits.Count > 0 ? $"{crits.Count} crits ({crits.Min()}..{crits.Max()})" : "no crits this run (10% chance each)");
				Check("On Fire! applied to the target", onFireSeen, onFireSeen ? "debuff seen" : "never seen");
			}

			var result = new {
				runId,
				passed = allPass,
				timestamp = DateTime.UtcNow.ToString("o"),
				tModLoader = BuildInfo.versionedName,
				swings,
				swingIntervals = intervals,
				hits = Hits.Select(h => new { damage = h.Damage, crit = h.Crit, damageClass = h.DamageClass }),
				critCount = crits.Count,
				onFire = onFireSeen,
				checks,
			};
			Directory.CreateDirectory(Folder);
			File.WriteAllText(Path.Combine(Folder, "results.json"),
				JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
			Log($"Finished: {(allPass ? "ALL PASS" : "FAILED")}. Quitting.");
			Main.instance.Exit();
		}
	}

	/// <summary>Holds the use-item control during the test and keeps the test character alive.</summary>
	public class AutoTestPlayer : ModPlayer
	{
		public override void SetControls() {
			if (AutoTestSystem.Swinging && Player.whoAmI == Main.myPlayer)
				Player.controlUseItem = true;
		}

		public override void PreUpdate() {
			if (AutoTestSystem.Active && Player.whoAmI == Main.myPlayer) {
				Player.statLife = Player.statLifeMax2;
				Player.immune = true;
				Player.immuneTime = 2;
			}
		}

		public override void PostItemCheck() {
			if (AutoTestSystem.Swinging && Player.whoAmI == Main.myPlayer && Player.ItemAnimationJustStarted
				&& Player.HeldItem.type == ModContent.ItemType<EmberBlade>())
				AutoTestSystem.SwingStarts.Add(Main.GameUpdateCount);
		}
	}

	/// <summary>Freezes the test targets in place, records hits on them, and stops natural spawns.</summary>
	public class AutoTestGlobalNPC : GlobalNPC
	{
		public override bool PreAI(NPC npc) {
			if (AutoTestSystem.Active && AutoTestSystem.Anchors.TryGetValue(npc.whoAmI, out Vector2 anchor)) {
				npc.position = anchor;
				npc.velocity = Vector2.Zero;
				return false;
			}
			return true;
		}

		public override void OnHitByItem(NPC npc, Player player, Item item, NPC.HitInfo hit, int damageDone) {
			if (AutoTestSystem.Swinging && AutoTestSystem.TargetNpcs.Contains(npc.whoAmI))
				AutoTestSystem.Hits.Add((damageDone, hit.Crit, hit.DamageType.GetType().Name));
		}

		public override void EditSpawnRate(Player player, ref int spawnRate, ref int maxSpawns) {
			if (AutoTestSystem.Active)
				maxSpawns = 0;
		}
	}
}
