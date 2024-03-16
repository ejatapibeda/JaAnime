const axios = require("axios");
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const builder = new addonBuilder({
  id: "org.janime",
  version: "1.0.0",
  name: "jAnime",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
});

async function fetchData(query, episodeNumber, date) {
  const data = await fetchFromAniwatch(`/anime/search/suggest?q=${query}`);
  const formattedDate = await formatDate(date);
  const dateMatch = data.suggestions.find(
    (s) => s.moreInfo[0] === formattedDate
  );
  const exactMatch = data.suggestions.find(
    (s) => s.name.toLowerCase() === query.toLowerCase()
  );

  let suggestion;
  if (exactMatch) {
    suggestion = exactMatch;
  } else if (dateMatch) {
    suggestion = dateMatch;
  } else {
    const partialMatches = data.suggestions.filter((s) =>
      query
        .toLowerCase()
        .split(" ")
        .some((word) => s.name.toLowerCase().includes(word))
    );
    suggestion = partialMatches.sort(
      (a, b) =>
        query.split(" ").filter((word) => b.name.toLowerCase().includes(word))
          .length -
        query.split(" ").filter((word) => a.name.toLowerCase().includes(word))
          .length
    )[0];
  }

  if (suggestion) {
    const episodes = await fetchFromAniwatch(
      `/anime/episodes/${suggestion.id}`
    );
    const episode = episodes.episodes.find((e) => e.number === episodeNumber);

    if (episode) {
      return getSourceUrl(episode.episodeId);
    } else {
      console.log(`Tidak ada episode dengan nomor ${episodeNumber}`);
    }
  } else {
    console.log("Tidak ada suggestions yang memenuhi kriteria");
  }
}

async function fetchFromAniwatch(endpoint) {
  try {
    const resp = await axios.get(
      `https://api-aniwatch.onrender.com${endpoint}`
    );
    return resp.data;
  } catch (error) {
    console.error(`Error fetching data from Aniwatch at ${endpoint}:`, error);
    return null;
  }
}

async function getSourceUrl(episodeId) {
  try {
    const resp = await axios.get(
      `https://api-aniwatch.onrender.com/anime/episode-srcs?id=${episodeId}&server=vidstreaming&category=sub`
    );
    const source = resp.data.sources.find((s) => s.type === "hls");
    if (source) {
      return source.url;
    } else {
      console.log(`Tidak ada sumber dengan HLS`);
      return null;
    }
  } catch (error) {
    console.error("Error in getSourceUrl:", error);
    return null;
  }
}

async function formatDate(dateString) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const [year, month, day] = dateString.split("-");
  const monthName = months[parseInt(month, 10) - 1];

  return `${monthName} ${parseInt(day, 10)}, ${year}`;
}

async function getTmdbData(imdbId, isMovie) {
  try {
    const response = await axios.get(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=7ac6de5ca5060c7504e05da7b218a30c&external_source=imdb_id`
    );
    if (isMovie) {
      return response.data.movie_results;
    } else {
      return response.data.tv_results;
    }
  } catch (error) {
    console.error(`Error fetching TMDb data for IMDb ID ${imdbId}:`, error);
    return null;
  }
}

async function getTmdbNameFromImdbId(imdbId, isMovie) {
  const data = await getTmdbData(imdbId, isMovie);
  if (data && data.length > 0) {
    return isMovie ? data[0].title : data[0].name;
  } else {
    throw new Error(
      `No ${isMovie ? "Movie" : "TV"} results found for the given IMDb ID`
    );
  }
}

async function getImdbDate(imdbId, isMovie) {
  const data = await getTmdbData(imdbId, isMovie);
  if (data && data.length > 0) {
    return isMovie ? data[0].release_date : data[0].first_air_date;
  } else {
    throw new Error(
      `No ${isMovie ? "Movie" : "TV"} results found for the given IMDb ID`
    );
  }
}

builder.defineStreamHandler(async ({ type, id }) => {
  try {
    let url;
    if (type === "movie") {
      const title = await getTmdbNameFromImdbId(id, true);
      const date = await getImdbDate(id, true);
      url = await fetchData(title, 1, date);
    } else if (type === "series") {
      const [imdbId, season, episode] = id.split(":");
      const title = await getTmdbNameFromImdbId(imdbId, false);
      const date = await getImdbDate(imdbId, false);
      url = await fetchData(`${title} season ${season}`, Number(episode), date);
    }

    if (url) {
      return Promise.resolve({
        streams: [{ url: url, title: `🎞️ Aniwatch - Auto` }],
      });
    } else {
      return Promise.reject(new Error("No streaming URL found"));
    }
  } catch (error) {
    return Promise.reject(error);
  }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: 7000 });
console.log("Addon hosting on http://localhost:7000");
