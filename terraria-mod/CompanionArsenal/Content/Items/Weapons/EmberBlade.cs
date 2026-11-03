using Microsoft.Xna.Framework;
using Terraria;
using Terraria.ID;
using Terraria.ModLoader;

namespace CompanionArsenal.Content.Items.Weapons
{
	/// <summary>
	/// Ember Blade: a standard swinging broadsword using Terraria's own melee mechanics
	/// (melee damage class, use time, knockback, crit, autoswing). On hit it sets enemies On Fire!.
	/// Stats come from the desktop companion's "ember-blade" definition, converted to Terraria units:
	/// 0.55 s use time ≈ 33 ticks; the companion's 10% total crit = 4% base + 6% item crit.
	/// </summary>
	public class EmberBlade : ModItem
	{
		/// <summary>Seconds of On Fire! applied on hit (Terraria buff times are in ticks, 60 per second).</summary>
		public const int OnFireTicks = 3 * 60;

		// Display name and tooltip live in Localization/en-US_Mods.CompanionArsenal.hjson.
		public override void SetDefaults() {
			Item.damage = 22;
			Item.DamageType = DamageClass.Melee;
			Item.crit = 6;
			Item.knockBack = 6.5f;

			Item.width = 32; // Matches the 32x32 texture; the swing hitbox is derived from it.
			Item.height = 32;

			Item.useStyle = ItemUseStyleID.Swing;
			Item.useTime = 33;
			Item.useAnimation = 33;
			Item.autoReuse = true;
			Item.UseSound = SoundID.Item1;

			Item.rare = ItemRarityID.Orange;
			Item.value = Item.sellPrice(silver: 54);
		}

		// Occasional embers trail the blade while it swings.
		public override void MeleeEffects(Player player, Rectangle hitbox) {
			if (Main.rand.NextBool(3)) {
				Dust dust = Dust.NewDustDirect(hitbox.TopLeft(), hitbox.Width, hitbox.Height, DustID.Torch);
				dust.noGravity = true;
				dust.velocity *= 0.6f;
			}
		}

		public override void OnHitNPC(Player player, NPC target, NPC.HitInfo hit, int damageDone) {
			target.AddBuff(BuffID.OnFire, OnFireTicks);
		}

		public override void OnHitPvp(Player player, Player target, Player.HurtInfo hurtInfo) {
			target.AddBuff(BuffID.OnFire, OnFireTicks);
		}

		public override void AddRecipes() {
			CreateRecipe()
				.AddRecipeGroup(RecipeGroupID.IronBar, 12)
				.AddIngredient(ItemID.Torch, 25)
				.AddTile(TileID.Anvils)
				.Register();
		}
	}
}
