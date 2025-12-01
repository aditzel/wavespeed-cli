import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Register all MCP prompt templates
 * Categories: Photography, Art Styles, Use Cases
 */
export function registerPrompts(server: McpServer): void {
  // ===== Photography Styles =====

  server.registerPrompt(
    "portrait",
    {
      title: "Portrait Photography",
      description: "Generate professional portrait photography",
      argsSchema: {
        subject: z.string().describe("Subject description (e.g., 'a woman', 'a man')"),
        style: z
          .string()
          .optional()
          .describe("Photography style (e.g., 'studio lighting', 'natural light', 'dramatic')"),
        background: z.string().optional().describe("Background description"),
      },
    },
    ({ subject, style, background }) => {
      const styleText = style || "professional studio lighting";
      const bgText = background ? `, ${background} background` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `A photorealistic portrait of ${subject}, ${styleText}${bgText}, high quality, detailed, professional photography, sharp focus, 8k`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "landscape",
    {
      title: "Landscape Photography",
      description: "Generate stunning landscape/nature photography",
      argsSchema: {
        scene: z.string().describe("Scene description (e.g., 'mountain range', 'beach sunset')"),
        mood: z
          .string()
          .optional()
          .describe("Mood/atmosphere (e.g., 'serene', 'dramatic', 'mystical')"),
        time: z
          .string()
          .optional()
          .describe("Time of day (e.g., 'golden hour', 'blue hour', 'night')"),
      },
    },
    ({ scene, mood, time }) => {
      const moodText = mood || "beautiful";
      const timeText = time ? `, ${time}` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `A ${moodText} ${scene}${timeText}, landscape photography, stunning composition, vibrant colors, professional quality, 4k, National Geographic style`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "product",
    {
      title: "Product Photography",
      description: "Generate professional product photography",
      argsSchema: {
        product: z.string().describe("Product description"),
        style: z
          .string()
          .optional()
          .describe("Photography style (e.g., 'minimalist', 'lifestyle', 'hero shot')"),
        background: z.string().optional().describe("Background (default: white)"),
      },
    },
    ({ product, style, background }) => {
      const styleText = style || "clean minimalist";
      const bgText = background || "white";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Professional product photography of ${product}, ${styleText} style, ${bgText} background, studio lighting, commercial quality, sharp details, 4k`,
            },
          },
        ],
      };
    },
  );

  // ===== Art Styles =====

  server.registerPrompt(
    "watercolor",
    {
      title: "Watercolor Art",
      description: "Generate watercolor painting style artwork",
      argsSchema: {
        subject: z.string().describe("Subject to paint"),
        palette: z
          .string()
          .optional()
          .describe("Color palette (e.g., 'pastel', 'vibrant', 'muted')"),
      },
    },
    ({ subject, palette }) => {
      const paletteText = palette ? `, ${palette} color palette` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `A beautiful watercolor painting of ${subject}${paletteText}, delicate brush strokes, soft edges, flowing colors, artistic, traditional watercolor technique`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "oil-painting",
    {
      title: "Oil Painting",
      description: "Generate classical oil painting style artwork",
      argsSchema: {
        subject: z.string().describe("Subject to paint"),
        style: z
          .string()
          .optional()
          .describe("Painting style (e.g., 'impressionist', 'baroque', 'renaissance')"),
      },
    },
    ({ subject, style }) => {
      const styleText = style || "classical";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `An exquisite ${styleText} oil painting of ${subject}, rich textures, visible brush strokes, museum quality, dramatic lighting, masterpiece`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "anime",
    {
      title: "Anime Style",
      description: "Generate anime/manga style artwork",
      argsSchema: {
        subject: z.string().describe("Character or scene description"),
        style: z
          .string()
          .optional()
          .describe("Anime style (e.g., 'shonen', 'shojo', 'ghibli', 'cyberpunk')"),
      },
    },
    ({ subject, style }) => {
      const styleText = style ? `${style} style ` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `${styleText}anime illustration of ${subject}, vibrant colors, detailed linework, professional anime art, high quality, trending on ArtStation`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "sketch",
    {
      title: "Pencil Sketch",
      description: "Generate pencil sketch/drawing style artwork",
      argsSchema: {
        subject: z.string().describe("Subject to sketch"),
        style: z
          .string()
          .optional()
          .describe("Sketch style (e.g., 'detailed', 'loose', 'architectural', 'portrait')"),
      },
    },
    ({ subject, style }) => {
      const styleText = style || "detailed";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `A ${styleText} pencil sketch of ${subject}, graphite drawing, fine linework, professional illustration, artistic shading, white paper background`,
            },
          },
        ],
      };
    },
  );

  // ===== Use Cases =====

  server.registerPrompt(
    "marketing",
    {
      title: "Marketing Image",
      description: "Generate marketing and advertising imagery",
      argsSchema: {
        product: z.string().describe("Product or service to promote"),
        message: z.string().optional().describe("Key message or tagline"),
        style: z
          .string()
          .optional()
          .describe("Visual style (e.g., 'modern', 'luxurious', 'playful')"),
      },
    },
    ({ product, message, style }) => {
      const styleText = style || "modern professional";
      const messageText = message ? `, conveying "${message}"` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `${styleText} marketing image for ${product}${messageText}, commercial photography, eye-catching composition, advertising quality, brand-worthy, clean design`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "social-media",
    {
      title: "Social Media Content",
      description: "Generate engaging social media content",
      argsSchema: {
        theme: z.string().describe("Content theme or subject"),
        platform: z
          .string()
          .optional()
          .describe("Platform (e.g., 'instagram', 'linkedin', 'twitter')"),
        aesthetic: z.string().optional().describe("Visual aesthetic"),
      },
    },
    ({ theme, platform, aesthetic }) => {
      const platformText = platform ? `${platform}-style ` : "";
      const aestheticText = aesthetic ? `, ${aesthetic} aesthetic` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `${platformText}social media content about ${theme}${aestheticText}, engaging visuals, scroll-stopping image, high engagement potential, trendy, shareable`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "concept-art",
    {
      title: "Concept Art",
      description: "Generate concept art for games, films, or creative projects",
      argsSchema: {
        concept: z.string().describe("Concept description"),
        genre: z
          .string()
          .optional()
          .describe("Genre (e.g., 'sci-fi', 'fantasy', 'horror', 'steampunk')"),
        purpose: z
          .string()
          .optional()
          .describe("Purpose (e.g., 'character', 'environment', 'prop')"),
      },
    },
    ({ concept, genre, purpose }) => {
      const genreText = genre ? `${genre} ` : "";
      const purposeText = purpose ? `${purpose} ` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `${genreText}${purposeText}concept art of ${concept}, professional concept design, detailed illustration, cinematic lighting, industry-standard quality, trending on ArtStation`,
            },
          },
        ],
      };
    },
  );
}
