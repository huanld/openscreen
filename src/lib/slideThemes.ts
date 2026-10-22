/**
 * Slide & Canvas Background Presets inspired by PowerPoint, Keynote, and Canva.
 * Compatible with classifyWallpaper and the export frameRenderer.
 */

import type { AspectRatio } from "@/utils/aspectRatioUtils";

export interface SlideDesignPatch {
	wallpaper?: string;
	aspectRatio?: AspectRatio;
	padding?: number;
	borderRadius?: number;
	shadowIntensity?: number;
}

export interface SlideFramingPreset {
	id: "slide169" | "desktop" | "story" | "square";
	name: string;
	aspectRatio: AspectRatio;
	padding: number;
	borderRadius: number;
	shadowIntensity: number;
}

export const SLIDE_FRAMING_PRESETS: readonly SlideFramingPreset[] = [
	{
		id: "slide169",
		name: "Slide 16:9",
		aspectRatio: "16:9",
		padding: 18,
		borderRadius: 16,
		shadowIntensity: 1.2,
	},
	{
		id: "desktop",
		name: "Mockup Card",
		aspectRatio: "16:9",
		padding: 14,
		borderRadius: 12,
		shadowIntensity: 1.5,
	},
	{
		id: "story",
		name: "Canva 9:16",
		aspectRatio: "9:16",
		padding: 16,
		borderRadius: 22,
		shadowIntensity: 1.2,
	},
	{
		id: "square",
		name: "Square 1:1",
		aspectRatio: "1:1",
		padding: 16,
		borderRadius: 18,
		shadowIntensity: 1,
	},
];

export interface SlideThemePreset {
	id: string;
	name: string;
	category: "keynote" | "canva" | "minimal" | "vibrant";
	value: string;
	suggestedPadding?: number;
	suggestedBorderRadius?: number;
	suggestedShadow?: number;
}

export const SLIDE_THEME_PRESETS: readonly SlideThemePreset[] = [
	// Keynote & Presentation Themes
	{
		id: "keynote-dark",
		name: "Keynote Dark",
		category: "keynote",
		value: "linear-gradient(145deg, #18191e 0%, #0d0e12 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 16,
		suggestedShadow: 1.2,
	},
	{
		id: "keynote-slate",
		name: "Keynote Slate",
		category: "keynote",
		value: "linear-gradient(135deg, #242938 0%, #151922 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 16,
		suggestedShadow: 1.3,
	},
	{
		id: "pitch-white",
		name: "Pitch Clean White",
		category: "minimal",
		value: "linear-gradient(145deg, #ffffff 0%, #eef2f6 100%)",
		suggestedPadding: 16,
		suggestedBorderRadius: 14,
		suggestedShadow: 1.0,
	},
	{
		id: "pitch-cream",
		name: "Pitch Editorial",
		category: "minimal",
		value: "linear-gradient(145deg, #faf8f5 0%, #ede8e1 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 12,
		suggestedShadow: 1.0,
	},
	{
		id: "corporate-navy",
		name: "Corporate Executive",
		category: "keynote",
		value: "linear-gradient(145deg, #0a192f 0%, #172a45 50%, #203a43 100%)",
		suggestedPadding: 20,
		suggestedBorderRadius: 16,
		suggestedShadow: 1.4,
	},
	{
		id: "tech-blueprint",
		name: "Tech Blueprint",
		category: "keynote",
		value: "linear-gradient(135deg, #0f172a 0%, #0369a1 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 14,
		suggestedShadow: 1.2,
	},
	{
		id: "studio-spotlight",
		name: "Studio Stage",
		category: "keynote",
		value: "radial-gradient(circle farthest-corner at 50% 10%, #2e1065 0%, #09090b 90%)",
		suggestedPadding: 22,
		suggestedBorderRadius: 18,
		suggestedShadow: 1.5,
	},

	// Canva Gradients & Aura
	{
		id: "canva-sunset",
		name: "Canva Sunset Glow",
		category: "canva",
		value: "linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 18,
		suggestedShadow: 1.2,
	},
	{
		id: "canva-aurora",
		name: "Canva Aurora Silk",
		category: "canva",
		value: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 16,
		suggestedShadow: 1.2,
	},
	{
		id: "canva-violet-indigo",
		name: "Canva Velvet Night",
		category: "canva",
		value: "linear-gradient(135deg, #654ea3 0%, #eaafc8 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 18,
		suggestedShadow: 1.3,
	},
	{
		id: "canva-ocean-wave",
		name: "Canva Ocean Breeze",
		category: "canva",
		value: "linear-gradient(135deg, #2af598 0%, #009efd 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 16,
		suggestedShadow: 1.1,
	},
	{
		id: "canva-neon-cyber",
		name: "Canva Cyberpunk Neon",
		category: "vibrant",
		value: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 20,
		suggestedShadow: 1.4,
	},
	{
		id: "canva-pastel-dream",
		name: "Canva Pastel Dream",
		category: "canva",
		value: "linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)",
		suggestedPadding: 16,
		suggestedBorderRadius: 20,
		suggestedShadow: 0.9,
	},
	{
		id: "canva-deep-space",
		name: "Canva Galaxy Deep",
		category: "vibrant",
		value: "linear-gradient(135deg, #141e30 0%, #243b55 100%)",
		suggestedPadding: 20,
		suggestedBorderRadius: 16,
		suggestedShadow: 1.3,
	},
	{
		id: "canva-warm-editorial",
		name: "Canva Warm Copper",
		category: "vibrant",
		value: "linear-gradient(135deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 16,
		suggestedShadow: 1.2,
	},
	{
		id: "canva-emerald-tech",
		name: "Canva Emerald Matrix",
		category: "vibrant",
		value: "linear-gradient(135deg, #0ba360 0%, #3cba92 100%)",
		suggestedPadding: 18,
		suggestedBorderRadius: 16,
		suggestedShadow: 1.2,
	},
];
