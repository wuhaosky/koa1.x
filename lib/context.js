"use strict";

/**
 * Module dependencies.
 */

var createError = require("http-errors");
var httpAssert = require("http-assert");
var delegate = require("delegates");
var statuses = require("statuses");

/**
 * Context prototype. koa上下文原型
 */

var proto = (module.exports = {
    /**
   * util.inspect() implementation, which
   * just returns the JSON output.
   * 
   * inspect方法返回 object 的字符串表示，主要用于调试
   * @return {Object}
   * @api public
   */

    inspect: function() {
        return this.toJSON();
    },

    /**
   * Return JSON representation.
   *
   * Here we explicitly invoke .toJSON() on each
   * object, as iteration will otherwise fail due
   * to the getters and cause utilities such as
   * clone() to fail.
   * 
   * 以JSON的形式输出对象信息
   * @return {Object}
   * @api public
   */

    toJSON: function() {
        return {
            request: this.request.toJSON(),
            response: this.response.toJSON(),
            app: this.app.toJSON(),
            originalUrl: this.originalUrl,
            req: "<original node req>",
            res: "<original node res>",
            socket: "<original node socket>"
        };
    },

    /**
   * Similar to .throw(), adds assertion.
   *
   *    this.assert(this.user, 401, 'Please login!');
   * 
   * See: https://github.com/jshttp/http-assert
   * 
   * 断言，断言为true则throw错误，同throw方法
   * @param {Mixed} test
   * @param {Number} status
   * @param {String} message
   * @api public
   */

    assert: httpAssert,

    /**
   * Throw an error with `msg` and optional `status`
   * defaulting to 500. Note that these are user-level
   * errors, and the message may be exposed to the client.
   *
   *    this.throw(403)
   *    this.throw(400, 'name required')
   *    this.throw('something exploded')
   *    this.throw(400, new Error('invalid'));
   *
   * See: https://github.com/jshttp/http-errors
   *
   * throw状态码和错误信息
   * @param {String|Number|Error} err, msg or status
   * @param {String|Number|Error} [err, msg or status]
   * @param {Object} [props]
   * @api public
   */

    throw: function() {
        throw createError.apply(null, arguments);
    },

    /**
   * Default error handling.
   * koa上下文报错的回调方法
   * 参考：https://ahonn.gitbooks.io/koa-analysis/content/koa/context.html
   * @param {Error} err
   * @api private
   */

    onerror: function(err) {
        // don't do anything if there is no error.
        // this allows you to pass `this.onerror`
        // to node-style callbacks.
        if (null == err) return;  // 首先对传入的 err 变量进行判断，当 err 为空时退出该函数
        
        if (!(err instanceof Error))  // 当 err 不为空且不为 Error 类型时抛出异常
            err = new Error("non-error thrown: " + err);

        var headerSent = false;
        if (this.headerSent || !this.writable) {  // 在此之前，设置 headerSent变量表示响应头是否发送，若响应头以发送，或者不可写（即无法在响应中添加错误信息等），则退出该函数。
            headerSent = err.headerSent = true;
        }

        // delegate
        this.app.emit("error", err, this);  // 接着触发 error 事件

        // nothing we can do here other
        // than delegate to the app-level
        // handler and log.
        if (headerSent) {
            return;
        }

        // first unset all headers
        if (this.res.getHeaderNames) {  // 因为发生了错误，所以必须将之前的中间设置的响应头信息清空。
            this.res.getHeaderNames().forEach(function(name) {
                this.removeHeader(name);
            }, this.res);
        } else {
            this.res._headers = {}; // Node < 8
        }

        // then set those specified
        this.set(err.headers); // 清空之前的中间件设置的响应头之后，将响应头设置为 err.headers，并设置 Context-Type 与状态码。
        
        
        // force text/plain
        this.type = "text";

        // ENOENT support
        if ("ENOENT" == err.code) err.status = 404; // 当错误码为 ENOENT 时，意味着找不到该资源，将状态码设置为 404；当没有状态码或err.status不是数字时默认设置为 500。
 
        // default to 500
        if ("number" != typeof err.status || !statuses[err.status])
            err.status = 500;

        // respond  当抛出的错误为自定义错误时，返回错误信息。
        var code = statuses[err.status];
        var msg = err.expose ? err.message : code;
        this.status = err.status;
        this.length = Buffer.byteLength(msg);
        this.res.end(msg);
    }
});

/**
 * Response delegation.
 * 将response的方法代理到koa上下文
 */

delegate(proto, "response")
    .method("attachment")
    .method("redirect")
    .method("remove")
    .method("vary")
    .method("set")
    .method("append")
    .access("status")
    .access("message")
    .access("body")
    .access("length")
    .access("type")
    .access("lastModified")
    .access("etag")
    .getter("headerSent")
    .getter("writable");

/**
 * Request delegation.
 * 将request的方法代理到koa上下文
 */

delegate(proto, "request")
    .method("acceptsLanguages")
    .method("acceptsEncodings")
    .method("acceptsCharsets")
    .method("accepts")
    .method("get")
    .method("is")
    .access("querystring")
    .access("idempotent")
    .access("socket")
    .access("search")
    .access("method")
    .access("query")
    .access("path")
    .access("url")
    .getter("origin")
    .getter("href")
    .getter("subdomains")
    .getter("protocol")
    .getter("host")
    .getter("hostname")
    .getter("header")
    .getter("headers")
    .getter("secure")
    .getter("stale")
    .getter("fresh")
    .getter("ips")
    .getter("ip");
