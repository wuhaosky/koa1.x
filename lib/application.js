"use strict";

/**
 * Module dependencies.
 */

var debug = require("debug")("koa:application");
var Emitter = require("events").EventEmitter;
var compose_es7 = require("composition");
var onFinished = require("on-finished");
var response = require("./response");
var compose = require("koa-compose");
var isJSON = require("koa-is-json");
var context = require("./context");
var request = require("./request");
var statuses = require("statuses");
var Cookies = require("cookies");
var accepts = require("accepts");
var assert = require("assert");
var Stream = require("stream");
var http = require("http");
var only = require("only");
var co = require("co");

/**
 * Application prototype.
 */

var app = Application.prototype;

/**
 * Expose `Application`.
 */

module.exports = Application;

/**
 * Initialize a new `Application`.
 *
 * @api public
 */

function Application() {
    if (!(this instanceof Application)) return new Application(); // 校验必须new Application
    this.env = process.env.NODE_ENV || "development"; // 当前环境
    this.subdomainOffset = 2;   // 二级域名偏移，细节见request文件
    this.middleware = []; // 中间件数组
    this.proxy = false; // 如果为 true，则支持 X-Forwarded-Host
    this.context = Object.create(context);
    this.request = Object.create(request);
    this.response = Object.create(response);
}

/**
 * Inherit from `Emitter.prototype`.
 */

Object.setPrototypeOf(Application.prototype, Emitter.prototype);

/**
 * Shorthand for:
 *
 *    http.createServer(app.callback()).listen(...)
 *
 * @param {Mixed} ...
 * @return {Server}
 * @api public
 */

app.listen = function() {
    debug("listen");
    var server = http.createServer(this.callback());
    return server.listen.apply(server, arguments);
};

/**
 * Return JSON representation.
 * We only bother showing settings.
 *
 * @return {Object}
 * @api public
 */

app.inspect = app.toJSON = function() {
    return only(this, ["subdomainOffset", "proxy", "env"]);
};

/**
 * Use the given middleware `fn`.
 *
 * @param {GeneratorFunction} fn
 * @return {Application} self
 * @api public
 */

app.use = function(fn) {
    if (!this.experimental) {
        // es7 async functions are not allowed,
        // so we have to make sure that `fn` is a generator function
        assert(
            fn && "GeneratorFunction" == fn.constructor.name,
            "app.use() requires a generator function"
        );
    }
    debug("use %s", fn._name || fn.name || "-");
    this.middleware.push(fn);
    return this;
};

/**
 * Return a request handler callback
 * for node's native http server.
 *
 * @return {Function}
 * @api public
 */

app.callback = function() {
    if (this.experimental) {
        console.error(
            "Experimental ES7 Async Function support is deprecated. Please look into Koa v2 as the middleware signature has changed."
        );
    }
    var fn = this.experimental
        ? compose_es7(this.middleware)
        : co.wrap(compose(this.middleware));
    var self = this;

    if (!this.listeners("error").length) this.on("error", this.onerror);  // 如果'error'的事件监听器数组是空的话，新增'error'事件的监听，触发后执行this.error回调

    return function handleRequest(req, res) {
        res.statusCode = 404;
        var ctx = self.createContext(req, res);
        onFinished(res, ctx.onerror);
        fn
            .call(ctx)    // koa中间件里的this指向koa的上下文对象
            .then(function handleResponse() {
                respond.call(ctx);  // koa回形针执行完后，执行respond方法，做些兜底工作
            })
            .catch(ctx.onerror);    
            // 假定koa中间件发生了错误，如果koa中间件里有try catch，则错误会被catch掉，不会进入ctx.onerror；否则，进入ctx.onerror。
            // 在ctx.onerror中，触发error事件，如果业务方监听了koa error事件，则进入业务方的事件回调，如果没有则进入koa缺省的事件回调，也就是app.onerror。
            // 事件回调执行完成，再次进入ctx.onerror作后续的处理。
    };
};

/**
 * Initialize a new context.
 *
 * @api private
 */

app.createContext = function(req, res) {
    var context = Object.create(this.context);
    var request = (context.request = Object.create(this.request));
    var response = (context.response = Object.create(this.response));
    context.app = request.app = response.app = this;  // app：指向koa应用实例
    context.req = request.req = response.req = req;   // req：指向node原生请求对象
    context.res = request.res = response.res = res;   // res：指向node原生响应对象
    request.ctx = response.ctx = context;
    request.response = response;                      // response：指向koa的响应对象
    response.request = request;                       // request：指向koa的请求对象
    context.onerror = context.onerror.bind(context);
    context.originalUrl = request.originalUrl = req.url;
    context.cookies = new Cookies(req, res, {
        keys: this.keys,
        secure: request.secure
    });
    context.accept = request.accept = accepts(req);
    context.state = {};  // state：用于在中间件传递信息
    return context;
};

/**
 * Default error handler.
 * koa应用级别的默认错误处理
 * @param {Error} err
 * @api private
 */

app.onerror = function(err) {
    assert(err instanceof Error, "non-error thrown: " + err);  // 断言err是不是Error类型

    if (404 == err.status || err.expose) return;   // 如果用户级别错误（status<500），直接return
    if (this.silent) return;   // 静默，直接return
    // DEPRECATE env-specific logging in v2
    if ("test" == this.env) return;

    var msg = err.stack || err.toString(); // 打印错误位置
    console.error();
    console.error(msg.replace(/^/gm, "  "));
    console.error();
};

/**
 * Response helper.
 * koa处理请求的收尾工作
 * 参考：https://ahonn.gitbooks.io/koa-analysis/content/koa/application.html
 */

function respond() {
    // allow bypassing koa
    if (false === this.respond) return;  // this.respond为false，直接return

    var res = this.res;
    if (res.headersSent || !this.writable) return; // 响应头已被发送，或者请求不可写，直接return

    var body = this.body;
    var code = this.status;

    // ignore body
    if (statuses.empty[code]) { // 当返回的状态码表示没有响应体时，响应体置空
        // strip headers
        this.body = null;
        return res.end();
    }

    // http method是head，且响应体是json，设置content-length
    if ("HEAD" == this.method) { 
        if (isJSON(body)) this.length = Buffer.byteLength(JSON.stringify(body));
        return res.end();
    }

    // status body
    if (null == body) {  // 当返回的状态码表示有响应体，但响应体为空时
        this.type = "text";  // 设置content-type
        body = this.message || String(code); // 设置响应体为响应信息或状态码
        this.length = Buffer.byteLength(body); // 设置content-length
        return res.end(body);
    }

    // responses  对不同的响应主体进行处理
    if (Buffer.isBuffer(body)) return res.end(body);
    if ("string" == typeof body) return res.end(body);
    if (body instanceof Stream) return body.pipe(res); // body是流时如何输出

    // body: json  // body是json时如何输出
    body = JSON.stringify(body);
    this.length = Buffer.byteLength(body);
    res.end(body);
}
