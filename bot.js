/**
 * Created by Alicia on 06/06/2015.
 */

var Twitter = require('twitter');

var HANDLE = '@suggest_movies';

var client = new Twitter(require('./twitter.private.json'));

var postingClient = client;
var statusClient = client;


/**
 * Returns a body of recent tweets for a given user id
 */
    function getStatusText(userId) {
    var body = "";
    statusClient.get('statuses/user_timeline/' + userId, function (error, tweets, response) {
        if (error) throw error;
        for (var i = 0; i < tweets.length; i++) {
            var tweetObj = tweets[i];
            body += tweetObj.text + " ";
        }
        body = cleanFeed(body);
        console.log(body);
    });
    return body;
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


/**
 * Start stream waiting for tweets
 */
client.stream('statuses/filter', {track: HANDLE}, function(stream) {
    stream.on('data', function(tweet) {
        console.log(tweet.text);
        console.log(getStatusText(tweet.user.id_str));
        //var message = "@"+tweet.user.screen_name+" some reply tweet "+new Date().getTime();
        //postingClient.post('statuses/update', {status: message},  function(error, tweet, response){
        //    if(error) throw error;
        //});
    });
    stream.on('error', function(error) {
        throw error;
    });
});
