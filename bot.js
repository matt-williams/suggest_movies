/**
 * Created by Alicia on 06/06/2015.
 * Extended by Matt on 06/06/2015.
 */

var Twitter = require('twitter');
var FindAnyFilm = require('findanyfilm');
var http = require('http');
var htmlparser = require("htmlparser2");
var NodeCache = require('node-cache');
var NodeGeocoder = require('node-geocoder');
var async = require('async');

var HANDLE = '@suggest_movies';

var client = new Twitter(require('./twitter.private.json'));
var findanyfilm = new FindAnyFilm(require('./findanyfilm.private.json'));
var cache = new NodeCache();
var geocoder = NodeGeocoder('openstreetmap', 'http');

var postingClient = client;
var statusClient = client;


/**
 * Returns a body of recent tweets for a given user id
 */
function getStatusText(userId, callback) {
  cache.get(userId, function(error, body) {
    if (!error && body) {
      console.log("Got body for " + userId + " from cache");
      callback(body);
    } else {
      body = "";
      statusClient.get('statuses/user_timeline/' + userId, function (error, tweets, response) {
        if (error) throw error;
        for (var i = 0; i < tweets.length; i++) {
          var tweetObj = tweets[i];
          body += tweetObj.text + " ";
        }
        body = cleanFeed(body);
        callback(body);
        cache.set(userId, body, 3600, function(error) {
          if (error) {
            console.log("Failed to cache body for " + userId + ": " + error);
          }
        });
      });
    }
  });
}

/**
 * Method to remove URL's, Twitter Handles, references and other auditory information
 * @param text
 * @returns {string}
 */
function cleanFeed(text) {
    var urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function(url) {
        return '';
    })
}


function getGenres(userId, callback) {
  var url = "http://localhost:3000/like/" + userId;
  console.log("Getting genres for user " + userId + " from "+ url);
  //callback(null, ["Adventure", "Action", "Classic", "Romance", "Bollywood", "Suspense", "Musical", "Drama", "Horror", "Foreign", "War"]);
  http.get(url, function(response) {
    var str = '';

    response.on('data', function (chunk) {
      str += chunk;
    });

    response.on('end', function () {
      callback(null, JSON.parse(str));
    });
  });
}


function getUsers(tweet) {
  // Get the users from the tweet text.
  var users = tweet.text.match(new RegExp('@[_0-9A-Za-z]*', 'g'));

  // Strip ourselves out.
  var ii = users.indexOf(HANDLE);
  if (ii > -1) {
    users.splice(ii, 1);
  }

  // Add in the sender.
  var allUsers = users.slice();
  allUsers.push('@' + tweet.user.screen_name);

  return {users: users, allUsers: allUsers};
}


function mergeGenres(genresByUser) {
  console.log("Merging " + JSON.stringify(genresByUser) + "...");
  var maxNumGenres = 0;
  for (var ii in genresByUser) {
    var genres = genresByUser[ii];
    maxNumGenres = Math.max(maxNumGenres, genres.length);
  }
  var aggGenreScoresObj = {};
  for (var ii in genresByUser) {
    var genres = genresByUser[ii];
    for (var jj in genres) {
      var genre = genres[jj];
      aggGenreScoresObj[genre] = (aggGenreScoresObj[genre] || 0) + maxNumGenres - jj;
    }
  }
  var aggGenreScoresArr = [];
  for (var genre in aggGenreScoresObj) {
    aggGenreScoresArr.push({genre: genre, score: aggGenreScoresObj[genre]});
  }
  aggGenreScoresArr.sort(function (a, b) { return b.score - a.score; });
  var genres = [];
  for (var ii in aggGenreScoresArr) {
    genres.push(aggGenreScoresArr[ii].genre);
  }
  console.log("... to " + JSON.stringify(genres));
  return genres;
}


function isCinemaTweet(tweet) {
  // TODO: Use Watson natural language API?
  return !!tweet.text.match(new RegExp('cinema|showing|theatre'), 'i');
}


/**
 * Filter a list of films based on a filter object.  All criteria in
 * the filter object must match for the film to pass.
 */
function filterFilms(films, filter) {
  var filteredFilms = [];
  for (ii in films) {
    var film = films[ii];
    var matched = true;
    for (filterKey in filter) {
      var filterValue = filter[filterKey];
      var filmValue = film[filterKey];
      var matchedFilter = false;
      if (filmValue === filterValue) {
        matchedFilter = true;
      } else if (filmValue instanceof Array) {
        for (jj in filmValue) {
          var value = filmValue[jj];
          if (value === filterValue) {
            matchedFilter = true;
          }
        }
      }
      matched = (matched && matchedFilter);
    }
    if (matched) {
      filteredFilms.push(film);
    }
  }
  return filteredFilms;
}


function recommendFilm(isCinema, genres, callback) {
  findanyfilm.getFilmsOutNow({format: isCinema ? 8 : 6}, function(films) {
    console.log(films.length + " films out now - filtering against " + genres);
    var filteredFilms;
    for (ii in genres) {
      var genre = genres[ii];
      filteredFilms = filterFilms(films, {genres: genre});
      console.log("Filtering by genre " + genre + " gives " + filteredFilms.length + " films");
      if (filteredFilms.length > 0) {
        break;
      }
    }
    var filmToWatch;
    if (filteredFilms.length > 0) {
      var ii = Math.floor(Math.random() * filteredFilms.length);
      var filmToWatch = filteredFilms[ii];
    } else {
      console.log("No matches - just pick randomly from all films");
      var ii = Math.floor(Math.random() * films.length);
      filmToWatch = films[ii];
    }
    console.log("Suggesting " + JSON.stringify(filmToWatch));
    callback(filmToWatch);
  });
}

function getFilmImage(film, imageCallback, noImageCallback) {
  cache.get(film.faf_id, function(error, mediaId) {
    if (!error && mediaId) {
      console.log("Got media id " + mediaId + " from cache");
      imageCallback(mediaId);
    } else {
      console.log('Retrieving HTML at ' + film.url);
      http.get(film.url, function(response) {
        var imageUrl = "";
        var parser = new htmlparser.Parser({
          onopentag: function(name, attribs){
            if (name === "img" && attribs.alt === "trailer_video") {
              imageUrl = "http:" + attribs.src;
            }
          }
        }, {decodeEntities: true});
      
        response.on('data', function (chunk) {
          parser.write(chunk);
        });
      
        response.on('end', function () {
          console.log('Retrieving image at ' + imageUrl);
          http.get(imageUrl, function(response) {
            response.setEncoding('binary');
            var chunks = [];
            
            response.on('data', function (chunk) {
              chunks.push(new Buffer(chunk, 'binary'));
            });
      
            response.on('end', function () {
              var data = Buffer.concat(chunks);
              console.log('Posting media');
              client.post('media/upload', {media_data: data.toString('base64')}, function(error, media, response) {
                if (error) throw error;
                var mediaId = media.media_id_string;
                cache.set(film.faf_id, mediaId, 86400, function(error) {
                  if (error) {
                    console.log("Failed to set " + film.faf_id + " = " + mediaId + ": " + error);
                  }
                });
                imageCallback(mediaId);
              });
            });
    
          }).on('error', function(error) {
            noImageCallback();
          });
        });
      });
    }
  });
}


function getImageAndTweet(film, message, inReplyTo) {
  getFilmImage(film, function(mediaId) {
    doTweet(message, mediaId, inReplyTo);
  }, function() {
    doTweet(message, null, inReplyTo);
  });
}


function doTweet(message, mediaId, inReplyTo) {
  console.log('Replying with "' + message + '"');
  var tweet = {status: message, in_reply_to_status_id: inReplyTo.id_str};
  if (mediaId) {
    tweet.media_ids = mediaId;
  }
  client.post('statuses/update', tweet,  function(error, tweet, response) {
    if (error) throw error;
  });
}


/**
 * Start stream waiting for tweets
 */
client.stream('statuses/filter', {track: HANDLE}, function(stream) {
    stream.on('data', function(tweet) {
        console.log(tweet.user.screen_name + ' tweeted "' + tweet.text + '"');

        var users = getUsers(tweet);
        var otherUsers = users.users.join(' ');
        if (otherUsers) {
          otherUsers += " ";
        }

        async.map(users.allUsers, getGenres, function(error, genresByUser) {
          if (error) throw error;
          var genres = mergeGenres(genresByUser);

          var isCinema = isCinemaTweet(tweet);
          var location = tweet.user.location;
  
          recommendFilm(isCinema, genres, function(film) {
            var question = ["What about", "How about", "Have you seen"][Math.floor(Math.random() * 3)];
            var question2 = ["What about", "How about"][Math.floor(Math.random() * 2)];
            var message = "@" + tweet.user.screen_name + " " + question + " " + film.title + "? " + otherUsers + film.url;
            if (isCinema && location) {
              geocoder.geocode(location).then(function(results) {
                if (results && results.length > 0) {
                  var result = results[0];
                  console.log('User location "' + location + '" => (' + result.latitude + ', ' + result.longitude + ')');
                  findanyfilm.getCinemas({faf_id: film.faf_id, latitude: result.latitude, longitude: result.longitude, maxresults: 1}, function(cinemas) {
                    if (cinemas.length > 0) {
                      var cinema = cinemas[0];
                      if (cinema.cinema_showtimes && cinema.cinema_showtimes.length > 0) {
                        var showtimes = cinema.cinema_showtimes[0];
                        var time = new Date(showtimes.time_from);
                        message = "@" + tweet.user.screen_name + " " + question2 + " " + film.title + " at " + time.getHours() + ":" + ("0" + time.getMinutes()).substr(-2, 2) + "? " + otherUsers;
                        if (showtimes.ticket_link) {
                          message += showtimes.ticket_link;
                        } else if (cinema.link) {
                          message += cinema.link;
                        } else {
                          message += film.url;
                        }
                      }
                    }
                    getImageAndTweet(film, message, tweet);
                  });
                } else {
                  getImageAndTweet(film, message, tweet);
                }
              }).catch(function(error) {
                getImageAndTweet(film, message, tweet);
              });
            } else if (!isCinema) {
              findanyfilm.getAvailability({faf_id: film.faf_id}, function(results) {
                if (results && results.available_formats) {
                  console.log("Availability: " + JSON.stringify(results.available_formats));
                  var retailer, link, price;
                  if (results.available_formats.Online) {
                    var onlines = results.available_formats.Online;
                    if (onlines instanceof Array) {
                      for (var ii in onlines) {
                        var online = onlines[ii];
                        if ((online.retailer || online.merchant) && online.link) {
                          retailer = online.retailer || online.merchant;
                          link = online.link;
                          price = online.price;
                          break;
                        }
                      }
                    } else if ((onlines.retailer || onlines.merchant) && onlines.link) {
                      retailer = onlines.retailer || onlines.merchant;
                      link = onlines.link;
                      price = onlines.price;
                    }
                  }
                  if (results.available_formats.Download) {
                    var downloads = results.available_formats.Download;
                    if (downloads instanceof Array) {
                      for (var ii in downloads) {
                        var download = downloads[ii];
                        if ((download.retailer || download.merchant) && download.link) {
                          retailer = download.retailer || download.merchant;
                          link = download.link;
                          price = download.price;
                          break;
                        }
                      }
                    } else if ((downloads.retailer || downloads.merchant) && downloads.link) {
                      retailer = downloads.retailer || downloads.merchant;
                      link = downloads.link;
                      price = downloads.price;
                    }
                  }
                  if (retailer && link) {
                    message = "@" + tweet.user.screen_name + " " + question + " " + film.title + " (£" + price + " from " + retailer + ") " + otherUsers + link;
                  }
                }
                getImageAndTweet(film, message, tweet);
              });
            } else {
              getImageAndTweet(film, message, tweet);
            }
          });
        });
    });
    stream.on('error', function(error) {
        throw error;
    });
});

