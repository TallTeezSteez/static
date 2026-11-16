// Starter channels: a hand-picked set per shelf, so Static has a few hundred solid videos on day one
// and something better than raw search to learn from. They count as "new to you" until Wyatt watches
// or likes one, and any of them can be hidden like any other channel.
// Each is a YouTube @handle. A handle that no longer exists is skipped without fuss.

const pack = (topic: string, handles: string) => handles.trim().split(/\s+/).map((handle) => ({ handle, topic }));

export const STARTER_CHANNELS: { handle: string; topic: string }[] = [
  ...pack('docs', `
    FreeDocumentary DWDocumentary frontline RealStories Wendoverproductions JohnnyHarris RealEngineering
    PracticalEngineeringChannel veritasium MagnatesMedia fern-tv ColdFusion LEMMiNO smartereveryday
    BusinessInsider VICENews NatGeo TimelineChannel AbsoluteHistory BrightSunFilms MentourPilot PolyMatter
    Asianometry TheB1M ModernMBA HowMoneyWorks neoexplains CNBC`),
  ...pack('truecrime', `
    ExploreWithUs JCSCriminalPsychology MatthewCox ThatChapter coffeehousecrime DatelineNBC 48hours
    LawAndCrime CourtTV Dreading MrBallen TheCasualCriminalist CodeBlueCam PoliceActivity RealWorldPolice
    AETV ABC2020 FBIFiles EWUBodycam StephanieHarlowe`),
  ...pack('tech', `
    LinusTechTips mkbhd JerryRigEverything Level1Techs JeffGeerling NetworkChuck CraftComputing TechnoTim
    LAWRENCESYSTEMS SpaceinvaderOne HardwareHaven ServeTheHomeVideo WolfgangsChannel christianlempa
    DavesGarage TechnologyConnections ShortCircuit Mrwhosetheboss StuffMadeHere TheLinuxEXP
    ChrisTitusTech Fireship`),
  ...pack('ai', `
    aiexplained-official matthew_berman TwoMinutePapers mreflow AndrejKarpathy IndyDevDan ColeMedin
    samwitteveenai AllAboutAI GregIsenberg anthropic-ai DwarkeshPatel WesRoth AICodeKing technovangelist
    bycloudAI 1littlecoder NateBJones leonvanzyl AlexFinnOfficial engineerprompt DavidOndrej t3dotgg
    AZisk`),
  ...pack('pcgaming', `
    GamersNexus HardwareUnboxed Jayztwocents DigitalFoundry SkillUp ACGreviews gameranxTV jackfrags
    Pestily optimumtech danielowentech paulshardware bitwitkyle LevelCapGaming TheActMan MandaloreGaming`),
  ...pack('football', `
    NFL NFLFilms ThePatMcAfeeShow BrettKollmann TheQBSchool SecretBase NFLThrowback isaacpunts
    The33rdTeam NFLonFOX FlemLoRaps UrinatingTree NBCSports TomGrossiComedy`),
  ...pack('outdoors', `
    MeatEaterTV Fresh_Tracks BornAndRaisedOutdoors TheHuntingPublic ElkShape CliffGray HUSHIN gohunt
    EpicOutdoors MTNOPS Rokslide EastmansHuntingJournals remiwarren cameronhanes NockOnTV dialedarchery
    JasonMatzinger OutdoorBoys XanderBudnick DanBeckerOutdoors`),
  ...pack('garage', `
    MattsOffRoadRecovery ViceGripGarage HeavyDSparks CleetusM SXSBlog DirtTraxTelevision FabRats
    RudysAdventureandDesign WinderTowingInc TFLtruck TFLoffroad EngineeringExplained ProjectFarm
    DebossGarage DieselCreek AndrewCamarata letsdig18 CuttingEdgeEngineering IDoCars WatchWesWork
    SouthMainAutoLLC FordTechMakuloco`),
  ...pack('shoptalk', `
    HVACS acservicetech HVACRVIDEOS WordofAdviceTV AntiDIYHVAC HomePerformance buildshow love2hvac
    HVACGuideforHomeowners grayfurnaceman diyhvacguy NewHVACGuide HVACKnowItAll MikeyPipes`),
  ...pack('business', `
    AlexHormozi TommyMelloHSE TheDiaryOfACEO MyFirstMillionPod CodieSanchezCT SimonSinek LeilaHormozi
    danmartell ServiceTitan ycombinator aliabdaal ChrisWillx`),
];
