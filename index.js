const net = require('net');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

const listen_PORT = 2500;
const Cloudflare_IP = '162.159.135.42';
const Cloudflare_port = 443;
const L_fragment = 77;
const fragment_sleep = 200;
const my_socket_timeout = 60000;
const first_time_sleep = 10;
const accept_time_sleep = 10;

function send_data_in_fragment(data, sock) {
    for (let i = 0; i < data.length; i += L_fragment) {
        const fragment_data = data.slice(i, i + L_fragment);
        console.log(`Sending ${fragment_data.length} bytes`);
        sock.write(fragment_data);
        sleep(fragment_sleep);
    }
}

function my_downstream(backend_sock, client_sock) {
    let first_flag = true;
    backend_sock.on('data', (data) => {
        try {
            if (first_flag) {
                first_flag = false;
                if (data) {
                    client_sock.write(data);
                } else {
                    throw new Error('backend pipe close at first');
                }
            } else {
                if (data) {
                    client_sock.write(data);
                } else {
                    throw new Error('backend pipe close');
                }
            }
        } catch (e) {
            console.log(`downstream: ${e}`);
            setTimeout(() => {
                backend_sock.destroy();
                client_sock.destroy();
            }, 2000);
        }
    });

    backend_sock.on('error', (err) => {
        if (err.code === 'ECONNRESET') {
            console.log(`backend socket error: ${err}`);
            setTimeout(() => {
                backend_sock.destroy();
                client_sock.destroy();
            }, 2000);
        } else {
            console.log(`backend socket error: ${err}`);
        }
    });
}

async function my_upstream(client_sock) {
    let first_flag = true;
    const backend_sock = new net.Socket();
    backend_sock.setTimeout(my_socket_timeout);

    while (true) {
        try {
            if (first_flag) {
                first_flag = false;
                await sleep(first_time_sleep);
                const data = await new Promise((resolve) => {
                    client_sock.once('data', (data) => resolve(data));
                });
                if (data) {
                    backend_sock.connect(Cloudflare_port, Cloudflare_IP);
                    my_downstream(backend_sock, client_sock);
                    send_data_in_fragment(data, backend_sock);
                } else {
                    throw new Error('cli syn close');
                }
            } else {
                const data = await new Promise((resolve) => {
                    client_sock.once('data', (data) => resolve(data));
                });
                if (data) {
                    backend_sock.write(data);
                } else {
                    throw new Error('cli pipe close');
                }
            }
        } catch (e) {
            console.log(`upstream: ${e}`);
            await sleep(2000);
            client_sock.destroy();
            backend_sock.destroy();
            return false;
        }
    }
}

function startServer() {
    const server = net.createServer((client_sock) => {
        client_sock.setTimeout(my_socket_timeout);
        sleep(accept_time_sleep).then(() => {
            const upstreamThread = new Promise((resolve) => {
                my_upstream(client_sock).then(resolve);
            });
            upstreamThread.catch((e) => console.log(`upstream thread error: ${e}`));
        });
    });

    server.on('error', (err) => {
        console.log(`server error: ${err}`);
    });

    server.listen(listen_PORT, () => {
        console.log(`Now listening at: 127.0.0.1:${listen_PORT}`);
    });
}

startServer();