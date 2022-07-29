// library definitions
const axios = require('axios');

// local definitions
const AxiosHelper = require('./axiosHelper');
const logger = require('./logger');

class Client {
    constructor(entitlementToken, accessToken) {
        this.region = null;
        this.puuid = null;
		this.gameName = null;
		this.gameTag = null;
        this.entitlementToken = entitlementToken;
        this.accessToken = accessToken;
        this.platform = "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";
        this.clientVersion = null;

        const axiosInstance = axios.create();

        // request interceptor
        axiosInstance.interceptors.request.use(this._handleConfig, this._handleReqError);
    
        // response interceptor
        axiosInstance.interceptors.response.use(this._handleSuccess, this._handleResError);

        this.axios = axiosInstance;

		this.vulxAxios;
    }
    
    // axios interceptor functions
    _handleConfig = (config) => {
        config.headers = {
            'X-Riot-Entitlements-JWT': this.entitlementToken,
            'Authorization': `Bearer ${this.accessToken}`,
            'X-Riot-ClientVersion': this.clientVersion,
            'X-Riot-ClientPlatform': this.platform
        }
        return config;
    }

    _handleReqError = (error) => {
        return Promise.reject(error)
    }

    _handleSuccess = (response) => {
        return response;
    }

    _handleResError = (error) => {
        const originalRequest = error.config;
        if (error.response.status === 400) {
            this._refreshEntitlement();
            logger.info("Refreshing entitlements...");
            return this.axios(originalRequest);
        }
		return Promise.reject(error)
    }
    
    // initialization functions
    async _doInitialize() {
		await this._initializeVulxAxios();
        await this._initializeSession();
        await this._initializeAuth();
        await this._initializeVersion();
		await this._initializeUserInfo();

		//await this.vulxAxios.get('/chat/v1/session').then(res => console.log(res.data))
    }

    async _initialize() {
        if(!this.initializationPromise) {
            this.initializationPromise = this._doInitialize();
        }
        return this.initializationPromise;
    }

	async _initializeUserInfo() {
		const userInfo = await this.vulxAxios.get('/chat/v1/session').then(res => res.data);
		this.gameName = userInfo.game_name;
		this.gameTag = userInfo.game_tag;
	}

	async _initializeVulxAxios() {
		this.vulxAxios = await AxiosHelper.getVulxAxios()
	}

    async _initializeSession() { //(phase) displays the current phase of the game (Pending, Idle, Gameplay)
		const externalSession = await this._getExternalSession();

		externalSession.launchConfiguration.arguments.forEach(arg => {
			if(arg.includes("-ares-deployment")) {
				this.region = arg.split("=")[1];
			} else if (arg.includes("-subject")) {
				this.puuid = arg.split("=")[1];
			}
		});
		logger.debug(`Got external session; Region: ${this.region} PUUID: ${this.puuid}`);
    }

    async _initializeAuth() {
        await this._refreshEntitlement();
    }

    async _initializeVersion() {
        const res = await this.axios.get(`https://glz-${this.region}-1.${this.region}.a.pvp.net/session/v1/sessions/${this.puuid}`).then(res => res.data);
        this.clientVersion = await res.clientVersion;
    }

    // internal use functions 
	async _getExternalSession() {
		const res = await this.vulxAxios.get("/product-session/v1/external-sessions").catch(err => logger.debug('API response error getting external session.'));
		
		if (!res || !res.data || Object.keys(res.data).length == 0) {
			logger.debug("Failed to get external session, retrying...");
			await new Promise(resolve => setTimeout(resolve, 1000));
			return await this._getExternalSession();
		}
		return await res.data[Object.keys(res.data)[0]];
	}
    async _refreshEntitlement() {
        const response = await this.vulxAxios.get("/entitlements/v1/token");
        this.entitlementToken = response.data.token;
        this.accessToken = response.data.accessToken;
        logger.debug(`Entitlement token refreshed: ${this.entitlementToken}`);
        logger.debug(`Access token refreshed: ${this.accessToken}`);
        return true;
    }

    async _fetchMatchID(isPregame = true) {
        return await this.axios.get(`https://glz-${this.region}-1.${this.region}.a.pvp.net/${isPregame ? "pre-game" : "core-game"}/v1/players/${this.puuid}`)
            .then(res => res.data.MatchID);
    }

    // public functions
	async getPUUID() {
		await this._initialize();
		return this.puuid;
	}

	async getRegion() {
		await this._initialize();
		return this.region;
	}

	async getGameName() {
		await this._initialize();
		return this.gameName;
	}

	async getGameTag() {
		await this._initialize();
		return this.gameTag;
	}

    async fetchMatch() {
        await this._initialize();
        
        const loopState = await this._getLoopState();
        if (!(loopState == "PREGAME" || loopState == "INGAME")) 
            return false;
        const isPregame = loopState == "PREGAME" ? true : false;

        const matchID = await this._fetchMatchID(isPregame);
        if(!matchID)
            return false;

        const res = await this.axios.get(`https://glz-${this.region}-1.${this.region}.a.pvp.net/${isPregame ? "pre-game" : "core-game"}/v1/matches/${matchID}`).then(res => res.data);
        return res;
    }
    
    async fetchMatchLoadouts() { 
        await this._initialize();

        const loopState = await this._getLoopState();
        if (!(loopState == "PREGAME" || loopState == "INGAME")) 
            return false;
        const isPregame = loopState == "PREGAME" ? true : false;

        const matchID = await this._fetchMatchID(isPregame);

        const res = await this.axios.get(`https://glz-${this.region}-1.${this.region}.a.pvp.net/${isPregame ? "pre-game" : "core-game"}/v1/matches/${matchID}/loadouts`).then(res => res.data);
        return res;
    }

    async getPlayers(playerIDs) {
        await this._initialize();
        return await this.axios.put(`https://pd.${this.region}.a.pvp.net/name-service/v2/players`, playerIDs).then(res => res.data);
    }

    // value accessors
    async getClientVersion() {
        await this._initialize();
        return await this.clientVersion;
    }
}

module.exports = new Client();