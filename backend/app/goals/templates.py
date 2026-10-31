"""初中 9 科课标骨架。

结构维度提炼自 2022 版义务教育课程标准，只做参考脚手架，不含课标原文。
创建目标树时可用 semester_seed 预填学期总目标草稿，老师在此基础上改写。
"""

SUBJECT_NAMES = ("语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "道德与法治")

_TEMPLATES: dict[str, dict] = {
    "语文": {
        "domains": [
            {"name": "识字与写字", "themes": ["字词积累", "书写规范"], "competencies": ["语言运用"], "sample": "能正确读写并运用本学期要求积累的常用字词"},
            {"name": "阅读与鉴赏", "themes": ["现代文阅读", "文言文入门", "名著导读"], "competencies": ["思维能力", "审美创造"], "sample": "能概括文章主要内容，说出自己的阅读感受"},
            {"name": "表达与交流", "themes": ["书面写作", "口语交际"], "competencies": ["语言运用", "文化自信"], "sample": "能围绕主题写 500 字以上条理清楚的记叙文"},
            {"name": "梳理与探究", "themes": ["语文实践活动"], "competencies": ["思维能力"], "sample": "能围绕校园或社区问题完成一次小型调查并汇报"},
        ]
    },
    "数学": {
        "domains": [
            {"name": "数与代数", "themes": ["有理数", "整式与分式", "方程与不等式", "函数"], "competencies": ["运算能力", "抽象能力"], "sample": "能熟练进行有理数混合运算并说明算理"},
            {"name": "图形与几何", "themes": ["相交线与平行线", "三角形", "四边形", "圆"], "competencies": ["几何直观", "推理能力"], "sample": "能用基本事实证明简单的三角形全等"},
            {"name": "统计与概率", "themes": ["数据的收集与整理", "简单概率"], "competencies": ["数据观念"], "sample": "能用统计图表描述数据并得出结论"},
            {"name": "综合与实践", "themes": ["项目式学习"], "competencies": ["模型观念", "应用意识"], "sample": "能建立一次函数模型解决行程类实际问题"},
        ]
    },
    "英语": {
        "domains": [
            {"name": "听说", "themes": ["课堂用语", "日常话题对话"], "competencies": ["语言能力"], "sample": "能就熟悉话题进行 5 句以上的连续对话"},
            {"name": "读写", "themes": ["语篇阅读", "应用文写作"], "competencies": ["语言能力", "思维品质"], "sample": "能读懂 200 词左右的记叙文并抓住要点"},
            {"name": "语言知识", "themes": ["核心词汇", "基础语法"], "competencies": ["语言能力"], "sample": "能正确使用一般过去时描述已发生的事"},
            {"name": "文化意识", "themes": ["中外文化习俗比较"], "competencies": ["文化意识"], "sample": "能用简单英语介绍一个中外节日"},
        ]
    },
    "物理": {
        "domains": [
            {"name": "物质", "themes": ["物态变化", "物质的属性"], "competencies": ["物理观念"], "sample": "能举例说明生活里的熔化与凝固现象"},
            {"name": "运动与相互作用", "themes": ["机械运动", "力与运动", "压强与浮力"], "competencies": ["物理观念", "科学思维"], "sample": "能用惯性解释乘车刹车时的身体前倾"},
            {"name": "能量", "themes": ["声与光", "内能与热机", "电与磁", "电能输送"], "competencies": ["能量观念", "科学探究"], "sample": "能设计电路并用电流表电压表验证串并联规律"},
        ]
    },
    "化学": {
        "domains": [
            {"name": "物质的性质与变化", "themes": ["物理/化学变化", "空气与氧气", "碳及其氧化物"], "competencies": ["化学观念"], "sample": "能区分物理变化与化学变化并举例说明"},
            {"name": "物质构成的奥秘", "themes": ["分子与原子", "元素与化学式", "质量守恒"], "competencies": ["微粒观念", "科学思维"], "sample": "能依据质量守恒定律解释常见反应的质量关系"},
            {"name": "化学与社会", "themes": ["燃烧与灭火", "金属材料", "溶液"], "competencies": ["科学态度与责任"], "sample": "能说出灭火原理并检查家庭火灾隐患"},
            {"name": "科学探究", "themes": ["实验基本操作"], "competencies": ["科学探究"], "sample": "能规范完成氧气制取与性质检验的分组实验"},
        ]
    },
    "生物": {
        "domains": [
            {"name": "生物体的结构层次", "themes": ["细胞", "组织器官系统"], "competencies": ["结构与功能观"], "sample": "能说出动植物细胞结构的异同"},
            {"name": "生物与环境", "themes": ["生态系统", "食物链与食物网"], "competencies": ["进化与适应观"], "sample": "能分析一条食物链中生物数量变化的相互影响"},
            {"name": "生物圈中的绿色植物", "themes": ["光合作用与呼吸作用"], "competencies": ["科学探究"], "sample": "能设计对照实验验证光照影响光合作用"},
            {"name": "健康地生活", "themes": ["人体生理", "传染病与免疫"], "competencies": ["社会责任"], "sample": "能说明接种疫苗预防传染病的道理"},
        ]
    },
    "历史": {
        "domains": [
            {"name": "中国古代史", "themes": ["史前与先秦", "秦汉统一", "隋唐宋元明清"], "competencies": ["时空观念", "家国情怀"], "sample": "能按顺序列出秦到清的主要朝代并各举一项制度"},
            {"name": "中国近现代史", "themes": ["近代化探索", "新民主主义革命", "新中国建设"], "competencies": ["史料实证", "家国情怀"], "sample": "能用两则史料说明洋务运动的影响"},
            {"name": "世界史", "themes": ["古代文明", "近现代格局"], "competencies": ["历史解释"], "sample": "能比较两次工业革命对世界格局的不同影响"},
        ]
    },
    "地理": {
        "domains": [
            {"name": "地球与地图", "themes": ["地球运动", "地图三要素"], "competencies": ["区域认知", "综合思维"], "sample": "能在等高线地形图上识别山脊与山谷"},
            {"name": "世界地理", "themes": ["海陆分布", "气候类型", "居民与聚落"], "competencies": ["综合思维"], "sample": "能举例说明纬度位置对气温的影响"},
            {"name": "中国地理", "themes": ["疆域与人口", "自然环境与自然资源", "区域差异"], "competencies": ["区域认知", "人地协调观"], "sample": "能说出我国地势三级阶梯对河流流向的影响"},
        ]
    },
    "道德与法治": {
        "domains": [
            {"name": "生命安全与健康教育", "themes": ["悦纳自我", "远离伤害"], "competencies": ["道德修养", "健全人格"], "sample": "能说出应对校园欺凌的两条正确做法"},
            {"name": "法治教育", "themes": ["宪法是根本法", "未成年人保护", "预防犯罪"], "competencies": ["法治观念"], "sample": "能结合案例说明宪法为什么是根本法"},
            {"name": "国情与责任", "themes": ["集体生活", "社会责任", "国家认同"], "competencies": ["责任意识", "政治认同"], "sample": "能举一个例子说明个人如何在集体中承担责任"},
            {"name": "道德修养", "themes": ["诚信友善", "家庭美德"], "competencies": ["道德修养"], "sample": "能讲述一次自己践行诚信的经历"},
        ]
    },
}


def get_template(subject: str) -> dict | None:
    return _TEMPLATES.get(subject)


def semester_seed(subject: str) -> list[dict]:
    """按学科素养维度返回学期总目标预填草稿。"""
    template = get_template(subject)
    if template is None:
        return []
    seed: list[dict] = []
    for domain in template["domains"]:
        competencies = "、".join(domain["competencies"])
        seed.append(
            {
                "title": f"{domain['name']}：学期总目标",
                "description": f"围绕{domain['name']}（涉及主题：{'、'.join(domain['themes'])}），参考：{domain['sample']}。",
                "verify_criteria": f"对应素养维度：{competencies}。学期末可通过课堂表现与作业证据核验达成情况。",
            }
        )
    return seed
