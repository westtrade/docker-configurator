FROM node:alpine

MAINTAINER Gennadiy Popov <me@westtrade.tk>

RUN apk add --no-cache make build-base gcc g++ python

WORKDIR /opt/
# Install yarn from the local .tgz
ADD https://yarnpkg.com/latest.tar.gz ./
RUN tar -xf latest.tar.gz && \
	mv /opt/dist /opt/yarn && \
	rm latest.tar.gz

ENV NODE_ENV="production"
ENV PATH "$PATH:/opt/yarn/bin"

# Install docker configurator
WORKDIR /etc/docker-configurator
ADD . .
RUN yarn

ENV DEBUG "docker-configurator"

CMD ["npm", "start"]
