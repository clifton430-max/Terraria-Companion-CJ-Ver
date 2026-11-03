using System.Collections.Generic;
using CompanionArsenal.Content.Items.Weapons;
using Terraria;
using Terraria.ID;
using Terraria.ModLoader;

namespace CompanionArsenal.Common.Commands
{
	/// <summary>
	/// Developer smoke test, available only in a dedicated server console: type <c>companioncheck</c>.
	/// It checks Ember Blade's defaults and recipe as loaded by the real game, then spawns a Target Dummy,
	/// applies the weapon's on-hit effect to it and confirms the buff. This exercises our code inside the
	/// engine, but it is NOT a substitute for swinging the sword in the client.
	/// </summary>
	public class SelfTestCommand : ModCommand
	{
		public override CommandType Type => CommandType.Console;
		public override string Command => "companioncheck";
		public override string Description => "Companion Arsenal: run a server-side smoke test of Ember Blade";

		public override void Action(CommandCaller caller, string input, string[] args) {
			var failures = new List<string>();
			void Check(bool ok, string what) {
				caller.Reply($"[{(ok ? "PASS" : "FAIL")}] {what}");
				if (!ok)
					failures.Add(what);
			}

			int type = ModContent.ItemType<EmberBlade>();
			var item = new Item(type);
			Check(item.type == type && item.ModItem is EmberBlade, $"item loads as ModItem (type {type})");
			Check(item.Name == "Ember Blade", $"localized name is '{item.Name}'");
			Check(item.damage == 22 && item.DamageType == DamageClass.Melee, $"damage {item.damage}, class {item.DamageType.GetType().Name}");
			Check(item.useStyle == ItemUseStyleID.Swing && item.useTime == 33 && item.useAnimation == 33, $"swing style, use time {item.useTime}/{item.useAnimation}");
			Check(item.crit == 6 && item.knockBack == 6.5f && item.autoReuse, $"crit +{item.crit}, knockback {item.knockBack}, autoswing {item.autoReuse}");
			Check(item.rare == ItemRarityID.Orange, $"rarity {item.rare}");

			bool recipeFound = false;
			for (int i = 0; i < Recipe.numRecipes; i++) {
				Recipe r = Main.recipe[i];
				if (r.createItem.type == type && r.HasRecipeGroup(RecipeGroupID.IronBar) && r.HasIngredient(ItemID.Torch) && r.HasTile(TileID.Anvils)) {
					recipeFound = true;
					break;
				}
			}
			Check(recipeFound, "recipe registered (12 Iron/Lead Bar + 25 Torch @ Anvil)");

			// Exercise the on-hit hook against a real NPC in the loaded world.
			int npcIndex = NPC.NewNPC(Entity.GetSource_None(), Main.spawnTileX * 16, Main.spawnTileY * 16 - 64, NPCID.TargetDummy);
			NPC dummy = Main.npc[npcIndex];
			Check(dummy.active && dummy.type == NPCID.TargetDummy, $"spawned Target Dummy (npc {npcIndex})");
			var hit = new NPC.HitInfo { Damage = item.damage, Knockback = item.knockBack, HitDirection = 1 };
			item.ModItem.OnHitNPC(Main.player[0], dummy, hit, item.damage);
			Check(dummy.HasBuff(BuffID.OnFire), "OnHitNPC applied On Fire! to the dummy");
			dummy.active = false;
			if (Main.netMode == NetmodeID.Server)
				NetMessage.SendData(MessageID.SyncNPC, number: npcIndex);

			caller.Reply(failures.Count == 0
				? "CompanionArsenal selftest done: ALL PASS"
				: $"CompanionArsenal selftest done: {failures.Count} FAILED");
		}
	}
}
