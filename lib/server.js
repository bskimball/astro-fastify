import { NodeApp } from "astro/app/node";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { polyfill } from "@astrojs/webapi";
import { fileURLToPath } from "url";
import { responseIterator } from "./response-iterator";

polyfill(globalThis, {
  exclude: "window document",
});

/**
 * @typedef {import('./types').ServerArgs} ServerArgs
 * @typedef {import('./types').DefineFastifyRoutes} DefineFastifyRoutes
 */

/** @type {DefineFastifyRoutes | undefined} */
const fastifyRoutes =
  // @ts-ignore
  typeof _astroFastifyRoutes != "undefined" ? _astroFastifyRoutes : undefined;

/**
 *
 * @param {import('astro').SSRManifest} manifest
 * @param {ServerArgs} options
 */
export function start(manifest, options) {
  const app = new NodeApp(manifest);

  const fastify = Fastify({
    logger: options.logger ?? true,
    maxParamLength: options.maxParamLength ?? 100
  });

  const clientRoot = new URL(options.clientRelative, import.meta.url);
  const clientAssetsRoot = new URL(
    "." + options.assetsPrefix,
    clientRoot + "/",
  );

  fastify.register((instance, _, next) => {
    instance.register(fastifyStatic, {
      root: fileURLToPath(clientAssetsRoot),
      prefix: options.assetsPrefix,
      decorateReply: false,
      /**
       * @param {import('http').ServerResponse} res
       */
      setHeaders(res) {
        res.setHeader("Cache-Control", "max-age=31536000,immutable");
      },
    });

    next();
  });

  /**
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} reply
   */
  const rootHandler = async (request, reply) => {
    const routeData = app.match(request.raw, { matchNotFound: true });
    if (routeData) {
      const response = await app.render(request.raw, { routeData });

      await writeWebResponse(app, reply.raw, response);
    } else {
      reply.status(404).type("text/plain").send("Not found");
    }
  };

  fastify.register((instance, _, next) => {
    instance.register(fastifyStatic, {
      root: fileURLToPath(clientRoot),
      /**
       * @param {import('http').ServerResponse} res
       */
      setHeaders(res) {
        res.setHeader("Cache-Control", "max-age=31536000,immutable");
      },
    });

    instance.setNotFoundHandler(rootHandler);

    next();
  });

  if (fastifyRoutes) {
    fastifyRoutes(fastify);
  }

  // Fallback route
  fastify.route({
    url: "/*",
    method: [
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "COPY",
      "MOVE",
      "LOCK",
      "MKCOL",
      "UNLOCK",
      "TRACE",
      "SEARCH",
      "OPTIONS",
      "PROPFIND",
      "PROPPATCH",
    ],
    handler: rootHandler,
  });

  const port = Number(options.port ?? (process.env.PORT || 8080));

  fastify.listen(
    {
      port,
      host: "0.0.0.0",
    },
    function (err) {
      if (err) {
        fastify.log.error(err);
        process.exit(1);
      }
      // Server is now listening on ${address}
    },
  );
}

/**
 * @param {NodeApp} app
 * @param {import('http').ServerResponse} res
 * @param {Response} webResponse
 */
async function writeWebResponse(app, res, webResponse) {
  const { status, headers, body } = webResponse;
  // Support the Astro.cookies API.
  if (app.setCookieHeaders) {
    const setCookieHeaders = Array.from(app.setCookieHeaders(webResponse));
    if (setCookieHeaders.length) {
      res.setHeader("Set-Cookie", setCookieHeaders);
    }
  }
  let headersObj = Object.fromEntries(headers.entries());
  res.writeHead(status, headersObj);
  if (body) {
    for await (const chunk of /** @type {any} */ responseIterator(body)) {
      res.write(chunk);
    }
  }
  res.end();
}

export function createExports(manifest, options) {
  return {
    start() {
      return start(manifest, options);
    },
  };
}
