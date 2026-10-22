const games = [
  { placeId: "16740784399", name: "Doğu Savaşı 2.5", creator: "Military Productions" },
  { placeId: "9679014784", name: "Afghanistan", creator: "League of Ghosts" },
  { placeId: "5975613030", name: "Syria", creator: "League of Ghosts" }
];

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Roblox endpoint returned " + response.status);
  return response.json();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Roblox player counts use universe IDs. Resolve each game's place ID so
    // the site cannot silently query the wrong experience ID.
    const resolved = await Promise.allSettled(games.map(async game => {
      const data = await fetchJson("https://apis.roblox.com/universes/v1/places/" + game.placeId + "/universe");
      if (!data || !data.universeId) throw new Error("Universe ID not found for place " + game.placeId);
      return { ...game, universeId: String(data.universeId) };
    }));
    const resolvedGames = resolved.map((item, index) => item.status === "fulfilled"
      ? item.value
      : { ...games[index], universeId: null });

    const universeIds = resolvedGames.map(game => game.universeId).filter(Boolean);
    const placeIds = games.map(game => game.placeId).join(",");
    const statsUrl = universeIds.length
      ? "https://games.roblox.com/v1/games?universeIds=" + encodeURIComponent(universeIds.join(","))
      : null;
    const iconsUrl = "https://thumbnails.roblox.com/v1/places/gameicons?placeIds=" + encodeURIComponent(placeIds) + "&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false";

    const [statsResult, iconsResult] = await Promise.allSettled([
      statsUrl ? fetchJson(statsUrl) : Promise.resolve({ data: [] }),
      fetchJson(iconsUrl)
    ]);
    const stats = statsResult.status === "fulfilled" ? statsResult.value.data || [] : [];
    const iconData = iconsResult.status === "fulfilled" ? iconsResult.value.data || [] : [];
    const currentGames = new Map(stats.map(game => [String(game.id), game]));
    const icons = new Map(iconData.map(icon => [String(icon.targetId), icon.imageUrl]));

    const result = resolvedGames.map(game => {
      const current = game.universeId ? currentGames.get(game.universeId) : null;
      return {
        ...game,
        playing: current ? Number(current.playing || 0) : null,
        maxPlayers: current ? Number(current.maxPlayers || 0) : null,
        icon: icons.get(game.placeId) || null,
        available: Boolean(current)
      };
    });

    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      games: result,
      statsAvailable: statsResult.status === "fulfilled",
      iconsAvailable: iconsResult.status === "fulfilled"
    });
  } catch (error) {
    console.error("Roblox live data request failed:", error);
    return res.status(502).json({ error: "Roblox verisi şu anda alınamıyor." });
  }
};
