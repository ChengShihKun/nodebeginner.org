import sourceMapSupport from "source-map-support";
import express from "express";
import proxy from "express-http-proxy";
import path from "path";
import fs from "fs";
import React from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter as Router, matchPath } from "react-router-dom";
import { Provider } from "react-redux";
import AppContainer from "../universal/react-components/container/AppContainer";
import createStore from "../universal/store";
import manifest from "../../dist/manifest.json";
import { initializeCommand } from "../universal/redux-actions/commands";
import routes from "../universal/routes";


sourceMapSupport.install();

const server = express();

const staticPath = path.resolve(__dirname); // Webpack will store the bundled server.js
                                            // file into dist, where the other static stuff ends up, too
console.info("Will serve static files from " + staticPath);

server.use(express.static(staticPath));

console.info("Will proxy requests to /api to http://127.0.0.1:8001/api");
server.use(
    "/api",
    proxy(
        "127.0.0.1:8001",
        {
            // The (mock) API server expects requests at /api/...
            proxyReqPathResolver: (req) => {
                const resolvedPath = "/api" + require("url").parse(req.url).path;
                console.info("Proxying to " + resolvedPath);
                return "http://127.0.0.1:8001" + resolvedPath;
            }
        }
    )
);

server.get("/*", (req, res) => {

    console.debug("__dirname:" + __dirname);
    console.debug("path.resolve(__dirname):" + path.resolve(__dirname));

    const templateFileName = path.resolve(__dirname, "..", "src", "universal", "html-templates", "index.html");

    fs.readFile(templateFileName, "utf8", (err, templateContent) => {
        if (err) {
            console.error('err', err);
            return res.status(404).end()
        }

        const store = createStore();
        store.dispatch(initializeCommand);

        const ssrDispatchHooks =
            routes
                .filter((route) => matchPath(req.url, route))                    // filter matching paths
                .map((route) => route.component)                                 // map to components
                .filter((component) => component.ssrDispatchHook)                // filter to components that have a SSR trigger
                .map((component) => {
                    console.debug("Triggering ssrDispatchHook on " + component.name);
                    store.dispatch(component.ssrDispatchHook());                   // dispatch trigger
                });

        Promise.all(ssrDispatchHooks).then(() => {
            const context = {};
            const jsx = (
                <Provider store={store}>
                    <Router context={context} location={req.url}>
                        <AppContainer/>
                    </Router>
                </Provider>
            );

            const reactDom = renderToString(jsx);

            res.writeHead(200, {"Content-Type": "text/html"});
            res.end(htmlTemplate(templateContent, reactDom, store));
        });
    });
});


console.info("SSR server listening on http://127.0.0.1:8000");
server.listen(8000);

const extractAssets = (assets, chunks) => Object.keys(assets)
    .filter(asset => chunks.indexOf(asset.replace('.js', '')) > -1)
    .map(k => assets[k]);

const extraChunks = extractAssets(manifest, ["main"])
    .map(c => `<script type="text/javascript" src="/${c}"></script>`);

const htmlTemplate = (templateContent, reactDom, store) => {
    return (
        templateContent
            // write the rendered React app DOM
            .replace('<div id="app"></div>', `<div id="app">${reactDom}</div>`)

            // write the Redux store state
            .replace("<!-- window.SSR_REDUX_STORE_STATE placeholder -->", `<script>window.SSR_REDUX_STORE_STATE = ${ JSON.stringify(store.getState()) }</script>`)

            // write the React JS app script tag
            .replace('<!-- SSR <script> placeholder -->', extraChunks.join(''))
    );
};
